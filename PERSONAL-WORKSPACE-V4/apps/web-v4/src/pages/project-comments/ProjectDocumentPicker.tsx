import { useState } from 'react';
import type { ProjectDocument } from '@scli/domain';
import { Paperclip } from '../../components/common/SctIcons';
import { V4FilterSelect } from '../../components/common/V4FilterSelect';

/** Linking and admission share the Project Files register; drafting never recreates a document. */
export function ProjectDocumentPicker({
  documents,
  value,
  onChange,
  onAddFile,
}: {
  documents: readonly ProjectDocument[];
  value: string;
  onChange: (id: string) => void;
  onAddFile?: (() => Promise<ProjectDocument | null>) | undefined;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [admitted, setAdmitted] = useState<ProjectDocument | null>(null);
  const available =
    admitted && !documents.some((document) => document.id === admitted.id)
      ? [...documents, admitted]
      : documents;
  return (
    <div className="v4-comments__file-picker">
      <V4FilterSelect
        label="Existing project document"
        value={value}
        options={[
          { value: '', label: 'No document' },
          ...available.map((document) => ({ value: document.id, label: document.title })),
        ]}
        onChange={onChange}
        disabled={pending}
      />
      {onAddFile && (
        <button
          type="button"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            setError(null);
            try {
              const document = await onAddFile();
              if (document) {
                setAdmitted(document);
                onChange(document.id);
              }
            } catch (error) {
              setError(error instanceof Error ? error.message : 'Could not add the file.');
            } finally {
              setPending(false);
            }
          }}
        >
          <Paperclip aria-hidden="true" />
          {pending ? 'Adding file…' : 'Attach file'}
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
