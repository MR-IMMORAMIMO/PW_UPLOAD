import { useEffect, useRef, useState } from 'react';
import { Paperclip, Send, X } from '../../components/common/SctIcons';
import type { ProjectDocument, ProjectContact } from '@scli/domain';
import { DraftAttachments } from './DraftAttachments';
import { ProjectContactPicker } from '../project-contacts/ProjectContactPicker';
import type { ContactDraft } from '../project-contacts/ContactDrawer';
import type { ThreadParticipant } from './commentsViewModel';

export type ReplyAuthorInput =
  | { origin: 'Internal' }
  | { origin: 'Client'; existingClientAuthorId: string }
  | { origin: 'Client'; authorName: string; authorRole: string };

export interface ReplySubmitInput {
  body: string;
  author: ReplyAuthorInput;
  documentId: string | null;
  documentIds?: string[];
}

interface ReplyComposerProps {
  formId?: string;
  onCanSendChange?: (ready: boolean) => void;
  contacts?: readonly ProjectContact[];
  onCreateContact?: ((draft: ContactDraft) => Promise<ProjectContact>) | undefined;
  onAddFile?: (() => Promise<ProjectDocument | null>) | undefined;
  onDirtyChange?: ((dirty: boolean) => void) | undefined;
  threadId: string;
  clientParticipants: readonly ThreadParticipant[];
  documents: readonly ProjectDocument[];
  pending: boolean;
  error: string | null;
  warning: string | null;
  focusRequest: number;
  onSubmit: (input: ReplySubmitInput) => Promise<boolean>;
  onRetryAttachment?: (() => void) | undefined;
}

export function ReplyComposer({
  threadId,
  clientParticipants,
  documents,
  pending,
  error,
  warning,
  focusRequest,
  onSubmit,
  onRetryAttachment,
  contacts = [],
  onCreateContact,
  onAddFile,
  onDirtyChange,
  formId,
  onCanSendChange,
}: ReplyComposerProps) {
  const [body, setBody] = useState('');
  const [origin, setOrigin] = useState<'Internal' | 'Client'>('Internal');
  const [clientMode, setClientMode] = useState<'existing' | 'new'>(
    clientParticipants.length ? 'existing' : 'new',
  );
  const [existingClientAuthorId, setExistingClientAuthorId] = useState(
    clientParticipants[0]?.authorId ?? '',
  );
  const [authorName, setAuthorName] = useState('');
  const [authorRole, setAuthorRole] = useState('');
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [documentIds, setDocumentIds] = useState<string[]>([]);
  const [documentPickerOpen, setDocumentPickerOpen] = useState(false);
  const [filePending, setFilePending] = useState(false);
  const [fileError, setFileError] = useState('');
  const [admitted, setAdmitted] = useState<ProjectDocument[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    onDirtyChange?.(
      Boolean(
        body.trim() || documentId || documentIds.length || authorName.trim() || authorRole.trim(),
      ),
    );
  }, [body, documentId, documentIds, authorName, authorRole, onDirtyChange]);

  useEffect(() => {
    if (focusRequest > 0) textareaRef.current?.focus();
  }, [focusRequest]);

  const author: ReplyAuthorInput =
    origin === 'Internal'
      ? { origin: 'Internal' }
      : clientMode === 'existing'
        ? { origin: 'Client', existingClientAuthorId }
        : { origin: 'Client', authorName: authorName.trim(), authorRole: authorRole.trim() };
  const authorValid =
    origin === 'Internal' ||
    (clientMode === 'existing'
      ? Boolean(existingClientAuthorId)
      : Boolean(authorName.trim() && authorRole.trim()));
  const selectedDocument = documents.find((document) => document.id === documentId) ?? null;
  const canSend = Boolean(body.trim() && authorValid && !pending && !filePending);
  useEffect(() => {
    onCanSendChange?.(canSend);
  }, [canSend, onCanSendChange]);

  const submit = async () => {
    if (!canSend) return;
    const succeeded = await onSubmit({
      body: body.trim(),
      author,
      documentId,
      ...(documentIds.length ? { documentIds } : {}),
    });
    if (succeeded) {
      setBody('');
      setDocumentId(null);
      setDocumentIds([]);
      setDocumentPickerOpen(false);
    }
  };

  return (
    <form
      id={formId}
      className="v4-comments__composer"
      data-thread-id={threadId}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="v4-comments__composer-author">
        <span>Reply as</span>
        <button
          type="button"
          aria-pressed={origin === 'Internal'}
          onClick={() => setOrigin('Internal')}
        >
          Internal
        </button>
        <button
          type="button"
          aria-pressed={origin === 'Client'}
          onClick={() => setOrigin('Client')}
        >
          Client
        </button>
      </div>
      {origin === 'Client' ? (
        <div className="v4-comments__client-author">
          <ProjectContactPicker
            contacts={contacts}
            onCreate={onCreateContact}
            onSelect={(contact) => {
              setClientMode('new');
              setAuthorName(contact.name);
              setAuthorRole(contact.role || contact.group || 'Client');
            }}
          />
          {clientParticipants.length ? (
            <div className="v4-comments__client-mode" role="group" aria-label="Client author type">
              <button
                type="button"
                aria-pressed={clientMode === 'existing'}
                onClick={() => setClientMode('existing')}
              >
                Existing participant
              </button>
              <button
                type="button"
                aria-pressed={clientMode === 'new'}
                onClick={() => setClientMode('new')}
              >
                New participant
              </button>
            </div>
          ) : null}
          {clientMode === 'existing' && clientParticipants.length ? (
            <label>
              <span>Client participant</span>
              <select
                value={existingClientAuthorId}
                onChange={(event) => setExistingClientAuthorId(event.target.value)}
              >
                {clientParticipants.map((participant) => (
                  <option key={participant.authorId} value={participant.authorId}>
                    {participant.name} — {participant.role || 'Client'}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="v4-comments__client-new-fields">
              <label>
                <span>Author name</span>
                <input value={authorName} onChange={(event) => setAuthorName(event.target.value)} />
              </label>
              <label>
                <span>Author role</span>
                <input value={authorRole} onChange={(event) => setAuthorRole(event.target.value)} />
              </label>
            </div>
          )}
        </div>
      ) : null}
      {selectedDocument ? (
        <div className="v4-comments__composer-document">
          <Paperclip aria-hidden="true" />
          <span>{selectedDocument.title}</span>
          <button
            type="button"
            aria-label="Remove linked document"
            onClick={() => setDocumentId(null)}
          >
            <X aria-hidden="true" />
          </button>
        </div>
      ) : null}
      {documentPickerOpen ? (
        <div
          className="v4-comments__document-picker"
          role="group"
          aria-label="Existing project document"
        >
          <DraftAttachments
            documents={[
              ...documents,
              ...admitted.filter((d) => !documents.some((v) => v.id === d.id)),
            ]}
            ids={documentIds}
            onChange={setDocumentIds}
            onAddFile={onAddFile}
          />
        </div>
      ) : null}
      <div className="v4-comments__composer-row">
        <textarea
          ref={textareaRef}
          aria-label="Write a reply"
          placeholder="Write a reply..."
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={1}
        />
        <button
          type="button"
          className="v4-comments__composer-icon"
          aria-label="Attach files to reply"
          disabled={!onAddFile || filePending}
          onClick={async () => {
            setFilePending(true);
            setFileError('');
            try {
              const file = await onAddFile?.();
              if (file) {
                setAdmitted((items) => [...items.filter((d) => d.id !== file.id), file]);
                setDocumentIds((ids) => [...new Set([...ids, file.id])]);
                setDocumentPickerOpen(true);
              }
            } catch (cause) {
              setFileError(cause instanceof Error ? cause.message : 'Could not attach file.');
            } finally {
              setFilePending(false);
            }
          }}
        >
          <Paperclip aria-hidden="true" />
        </button>
        <button
          type="button"
          className="v4-comments__composer-icon"
          aria-label="Link existing project document"
          aria-expanded={documentPickerOpen}
          onClick={() => setDocumentPickerOpen((current) => !current)}
          disabled={!documents.length && !onAddFile}
        >
          Link file
        </button>
        {!formId && (
          <button
            type="submit"
            className="v4-comments__composer-icon v4-comments__composer-send"
            aria-label="Send reply"
            disabled={!canSend}
          >
            <Send aria-hidden="true" />
          </button>
        )}
      </div>
      {error ? (
        <p className="v4-comments__mutation-error" role="alert">
          {error}
        </p>
      ) : null}
      {fileError && <p role="alert">{fileError}</p>}
      {warning ? (
        <div className="v4-comments__mutation-warning" role="status">
          <span>{warning}</span>
          {onRetryAttachment ? (
            <button type="button" onClick={onRetryAttachment}>
              Retry link
            </button>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
