import { useState } from 'react';
import type { ProjectDocument } from '@scli/domain';
import { SctAttachment, SctRemove } from '../../components/common/SctIcons';
import { ProjectDocumentPicker } from './ProjectDocumentPicker';

export function DraftAttachments({
  ids,
  documents,
  onChange,
  onAddFile,
}: {
  ids: readonly string[];
  documents: readonly ProjectDocument[];
  onChange: (ids: string[]) => void;
  onAddFile?: (() => Promise<ProjectDocument | null>) | undefined;
}) {
  const [admitted, setAdmitted] = useState<ProjectDocument[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const available = [
    ...documents,
    ...admitted.filter((d) => !documents.some((x) => x.id === d.id)),
  ];
  const add = (id: string) => {
    if (id && !ids.includes(id)) onChange([...ids, id]);
  };
  return (
    <section aria-label="Draft attachments">
      <ProjectDocumentPicker documents={available} value="" onChange={add} />
      {onAddFile && (
        <button
          type="button"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            setError('');
            try {
              const document = await onAddFile();
              if (document) {
                setAdmitted((a) => [...a, document]);
                add(document.id);
              }
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'Could not attach file.');
            } finally {
              setPending(false);
            }
          }}
        >
          <SctAttachment />
          {pending ? 'Adding file…' : 'Attach files'}
        </button>
      )}
      <ul>
        {ids.map((id) => (
          <li
            key={id}
            style={{ display: 'flex', alignItems: 'center', gap: 8, overflowWrap: 'anywhere' }}
          >
            <SctAttachment />
            <span>{available.find((d) => d.id === id)?.title ?? 'Project document'}</span>
            <button
              type="button"
              aria-label={`Remove attachment ${available.find((d) => d.id === id)?.title ?? 'Project document'}`}
              onClick={() => onChange(ids.filter((x) => x !== id))}
            >
              <SctRemove />
            </button>
          </li>
        ))}
      </ul>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
