import { V4DateInput } from '../../components/common/V4DateInput';
import { V4Button } from '../../components/common/V4Button';
import { SctSave } from '../../components/common/SctIcons';
import { businessTodayKey } from '../../date-time/businessDateTime';
import { useMemo, useRef, useState } from 'react';
import { useV4DirtySurface } from '../../components/interaction/V4DirtyGuard';
import { V4ConfirmDialog } from '../../components/common/V4ConfirmDialog';
import type {
  LuminaireRecord,
  ProjectDocument,
  ProjectReviewItem,
  ProjectRevision,
  ReviewOrigin,
  WorkspaceSourceType,
  ProjectContact,
} from '@scli/domain';
import { V4Drawer } from '../../components/common/V4Drawer';
import { DraftAttachments } from './DraftAttachments';
import { ProjectContactPicker } from '../project-contacts/ProjectContactPicker';
import type { ContactDraft } from '../project-contacts/ContactDrawer';

const sources: WorkspaceSourceType[] = ['Manual', 'Email', 'Meeting', 'PDF', 'Drawing'];
const today = () => businessTodayKey();

export interface CommentDraft {
  title: string;
  origin: ReviewOrigin;
  authorName: string;
  authorRole: string;
  description: string;
  sourceType: WorkspaceSourceType;
  receivedAt: string;
  dueDate: string;
  area: string;
  drawingReference: string;
  revisionId: string;
  luminaireId: string;
  documentId: string;
  documentIds?: string[];
}

const draftFor = (item: ProjectReviewItem | null): CommentDraft => ({
  title: item?.title ?? '',
  origin: item?.origin ?? 'Internal',
  authorName: item?.authorNameSnapshot ?? '',
  authorRole: item?.authorRoleSnapshot ?? '',
  description: item?.description ?? '',
  sourceType: item?.sourceType ?? 'Manual',
  receivedAt: item?.receivedAt ?? today(),
  dueDate: item?.dueDate ?? '',
  area: item?.area ?? '',
  drawingReference: item?.drawingReference ?? '',
  revisionId: item?.revisionId ?? '',
  luminaireId: item?.luminaireId ?? '',
  documentId: '',
  documentIds: [],
});

interface CommentDrawerProps {
  contacts?: readonly ProjectContact[];
  onCreateContact?: ((draft: ContactDraft) => Promise<ProjectContact>) | undefined;
  onAddFile?: (() => Promise<ProjectDocument | null>) | undefined;
  open: boolean;
  item: ProjectReviewItem | null;
  revisions: readonly ProjectRevision[];
  luminaires: readonly LuminaireRecord[];
  documents: readonly ProjectDocument[];
  pending: boolean;
  error: string | null;
  warning: string | null;
  onClose: () => void;
  onSave: (draft: CommentDraft) => Promise<boolean>;
  onRetryAttachment?: (() => void) | undefined;
}

export function CommentDrawer(props: CommentDrawerProps) {
  if (!props.open) return null;
  return <OpenCommentDrawer {...props} />;
}

function OpenCommentDrawer({
  item,
  revisions,
  luminaires,
  documents,
  pending,
  error,
  warning,
  onClose,
  onSave,
  onRetryAttachment,
  contacts = [],
  onCreateContact,
  onAddFile,
}: Omit<CommentDrawerProps, 'open'>) {
  const initial = useMemo(() => draftFor(item), [item]);
  const [draft, setDraft] = useState(initial);
  const [discarding, setDiscarding] = useState(false);
  const editing = Boolean(item);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const navigation = useRef<{ proceed: () => void; cancel: () => void } | null>(null);
  useV4DirtySurface(dirty, (_reason, proceed, cancel) => {
    if (pending) {
      cancel();
      return;
    }
    navigation.current = { proceed, cancel };
    setDiscarding(true);
  });
  const valid = Boolean(
    draft.title.trim() &&
    draft.description.trim() &&
    draft.receivedAt &&
    (draft.origin === 'Internal' || (draft.authorName.trim() && draft.authorRole.trim())),
  );
  const close = () => {
    if (!pending) {
      if (dirty) setDiscarding(true);
      else onClose();
    }
  };
  const update = <K extends keyof CommentDraft>(key: K, value: CommentDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  return (
    <V4Drawer
      presentation="float"
      open
      className="v4-comments__drawer"
      title={editing ? 'Edit Comment' : 'Add Comment'}
      description={
        editing
          ? 'Update thread details without changing authored identity.'
          : 'Create a client or internal project review thread.'
      }
      onClose={close}
      dismissible={!pending}
      footer={
        <div className="v4-comments__drawer-footer">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="v4-comments__primary"
            disabled={!valid || pending}
            onClick={() => void onSave(draft)}
          >
            {pending ? 'Saving…' : editing ? 'Save Changes' : 'Add Comment'}
          </button>
        </div>
      }
    >
      <V4ConfirmDialog
        open={discarding}
        destructive
        title="Unsaved comment changes"
        description="Save your changes before closing?"
        cancelLabel="Continue editing"
        confirmLabel="Discard"
        additionalAction={
          <V4Button
            variant="primary"
            disabled={!valid || pending}
            onClick={async () => {
              setDiscarding(false);
              if (await onSave(draft)) {
                const next = navigation.current;
                navigation.current = null;
                next?.proceed();
              }
            }}
          >
            <SctSave />
            Save changes
          </V4Button>
        }
        onCancel={() => {
          navigation.current?.cancel();
          navigation.current = null;
          setDiscarding(false);
        }}
        onConfirm={() => {
          const next = navigation.current;
          navigation.current = null;
          setDiscarding(false);
          onClose();
          next?.proceed();
        }}
      />
      <div className="v4-comments__drawer-form">
        <label>
          <span>Title</span>
          <input
            value={draft.title}
            maxLength={300}
            onChange={(event) => update('title', event.target.value)}
          />
        </label>
        <fieldset disabled={editing}>
          <legend>Origin</legend>
          <div className="v4-comments__origin-choice">
            {(['Internal', 'Client'] as const).map((origin) => (
              <button
                key={origin}
                type="button"
                aria-pressed={draft.origin === origin}
                onClick={() => update('origin', origin)}
              >
                {origin}
              </button>
            ))}
          </div>
        </fieldset>
        {!editing && draft.origin === 'Client' ? (
          <div className="v4-comments__drawer-grid">
            <ProjectContactPicker
              contacts={contacts}
              onCreate={onCreateContact}
              onSelect={(contact) =>
                setDraft((current) => ({
                  ...current,
                  authorName: contact.name,
                  authorRole: contact.role || contact.group || 'Client',
                }))
              }
            />
            <label>
              <span>Author name</span>
              <input
                value={draft.authorName}
                onChange={(event) => update('authorName', event.target.value)}
              />
            </label>
            <label>
              <span>Author role</span>
              <input
                value={draft.authorRole}
                onChange={(event) => update('authorRole', event.target.value)}
              />
            </label>
          </div>
        ) : null}
        <label>
          <span>Description</span>
          <textarea
            rows={5}
            value={draft.description}
            onChange={(event) => update('description', event.target.value)}
          />
        </label>
        <section className="v4-comments__drawer-context">
          <div>
            <strong>Context</strong>
            <span>Optional project links and tracking details</span>
          </div>
          <div className="v4-comments__drawer-grid">
            <label>
              <span>Source medium</span>
              <select
                value={draft.sourceType}
                onChange={(event) =>
                  update('sourceType', event.target.value as WorkspaceSourceType)
                }
              >
                {sources.map((source) => (
                  <option key={source}>{source}</option>
                ))}
              </select>
            </label>
            <label htmlFor="comment-received-date">
              <span>Received date</span>
              <V4DateInput
                id="comment-received-date"
                type="date"
                value={draft.receivedAt}
                onChange={(event) => update('receivedAt', event.target.value)}
              />
            </label>
            <label htmlFor="comment-due-date">
              <span>Due date</span>
              <V4DateInput
                id="comment-due-date"
                type="date"
                value={draft.dueDate}
                onChange={(event) => update('dueDate', event.target.value)}
              />
            </label>
            <label>
              <span>Area</span>
              <input value={draft.area} onChange={(event) => update('area', event.target.value)} />
            </label>
            <label>
              <span>Drawing reference</span>
              <input
                value={draft.drawingReference}
                onChange={(event) => update('drawingReference', event.target.value)}
              />
            </label>
            <label>
              <span>Revision</span>
              <select
                value={draft.revisionId}
                onChange={(event) => update('revisionId', event.target.value)}
              >
                <option value="">No revision</option>
                {revisions.map((revision) => (
                  <option key={revision.id} value={revision.id}>
                    REV{String(revision.revisionNumber).padStart(2, '0')} — {revision.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Luminaire</span>
              <select
                value={draft.luminaireId}
                onChange={(event) => update('luminaireId', event.target.value)}
              >
                <option value="">No luminaire</option>
                {luminaires.map((luminaire) => (
                  <option key={luminaire.id} value={luminaire.id}>
                    {luminaire.tag} — {luminaire.description}
                  </option>
                ))}
              </select>
            </label>
            <DraftAttachments
              documents={documents}
              ids={draft.documentIds ?? []}
              onChange={(ids) => update('documentIds', ids)}
              onAddFile={onAddFile}
            />
          </div>
        </section>
        {error ? (
          <p className="v4-comments__mutation-error" role="alert">
            {error}
          </p>
        ) : null}
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
      </div>
    </V4Drawer>
  );
}
