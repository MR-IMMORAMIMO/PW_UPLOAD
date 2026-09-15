import { useRef, useState } from 'react';
import type { ProjectReviewReply } from '@scli/domain';
import { V4Drawer } from '../../components/common/V4Drawer';
import { formatBusinessDateTime } from '../../date-time/businessDateTime';
import { useV4DirtySurface } from '../../components/interaction/V4DirtyGuard';
import { V4ConfirmDialog } from '../../components/common/V4ConfirmDialog';
import { V4Button } from '../../components/common/V4Button';
import { SctSave } from '../../components/common/SctIcons';
import type { ReactNode } from 'react';

export function ReplyEditor({
  reply,
  onClose,
  onSave,
  attachments,
}: {
  reply: ProjectReviewReply;
  onClose: () => void;
  onSave: (body: string) => Promise<void>;
  attachments?: ReactNode;
}) {
  const [body, setBody] = useState(reply.body);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [discard, setDiscard] = useState(false);
  const navigation = useRef<{ proceed: () => void; cancel: () => void } | null>(null);
  useV4DirtySurface(body !== reply.body, (_reason, proceed, cancel) => {
    if (pending) {
      cancel();
      return;
    }
    navigation.current = { proceed, cancel };
    setDiscard(true);
  });
  const close = () => {
    if (!pending) {
      if (body !== reply.body) setDiscard(true);
      else onClose();
    }
  };
  const save = async () => {
    if (!body.trim() || pending) return;
    setDiscard(false);
    setPending(true);
    setError('');
    try {
      await onSave(body.trim());
      const next = navigation.current;
      navigation.current = null;
      onClose();
      next?.proceed();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save this reply.');
    } finally {
      setPending(false);
    }
  };
  return (
    <V4Drawer
      open
      presentation="float"
      title="Edit reply"
      className="v4-comments__reply-editor"
      onClose={close}
      dismissible={!pending}
      footer={
        <>
          <button type="button" disabled={pending} onClick={close}>
            Cancel
          </button>
          <V4Button
            type="button"
            variant="primary"
            leadingIcon={<SctSave />}
            disabled={pending || !body.trim() || body === reply.body}
            onClick={() => void save()}
          >
            {pending ? 'Saving…' : 'Save reply'}
          </V4Button>
        </>
      }
    >
      <p>
        {reply.authorNameSnapshot} · {formatBusinessDateTime(reply.createdAt)}
      </p>
      <label>
        Reply
        <textarea
          value={body}
          maxLength={8000}
          rows={8}
          onChange={(event) => setBody(event.target.value)}
          disabled={pending}
        />
      </label>
      {attachments}
      {error && <p role="alert">{error}</p>}
      <V4ConfirmDialog
        open={discard}
        destructive
        title="Unsaved reply changes"
        description="Save your changes before closing?"
        cancelLabel="Continue editing"
        confirmLabel="Discard changes"
        additionalAction={
          <V4Button
            variant="primary"
            disabled={pending || !body.trim()}
            onClick={() => void save()}
          >
            <SctSave />
            Save changes
          </V4Button>
        }
        onCancel={() => {
          navigation.current?.cancel();
          navigation.current = null;
          setDiscard(false);
        }}
        onConfirm={() => {
          const next = navigation.current;
          navigation.current = null;
          setDiscard(false);
          onClose();
          next?.proceed();
        }}
      />
    </V4Drawer>
  );
}
