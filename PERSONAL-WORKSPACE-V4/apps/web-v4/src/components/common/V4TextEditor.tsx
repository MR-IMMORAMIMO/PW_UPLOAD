import { useState } from 'react';
import { V4Drawer } from './V4Drawer';
import { V4Button } from './V4Button';
import { V4ConfirmDialog } from './V4ConfirmDialog';
import { SctSave } from './SctIcons';

export function V4TextEditor({
  title,
  value,
  onSave,
  onClose,
}: {
  title: string;
  value: string;
  onSave: (value: string) => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [discard, setDiscard] = useState(false);
  const close = () => {
    if (!saving) {
      if (draft !== value) setDiscard(true);
      else onClose();
    }
  };
  const save = async () => {
    setDiscard(false);
    setSaving(true);
    setError('');
    try {
      await onSave(draft);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save changes.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <V4Drawer
      open
      presentation="float"
      className="v4-text-editor"
      title={title}
      dismissible={!saving}
      onClose={close}
      footer={
        <>
          <V4Button type="button" disabled={saving} onClick={close}>
            Cancel
          </V4Button>
          <V4Button
            variant="primary"
            type="button"
            disabled={saving || draft === value}
            onClick={() => void save()}
          >
            <SctSave />
            {saving ? 'Saving…' : 'Save changes'}
          </V4Button>
        </>
      }
    >
      <label className="v4-text-editor__field">
        {title}
        <textarea
          value={draft}
          rows={10}
          maxLength={8000}
          disabled={saving}
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <V4ConfirmDialog
        open={discard}
        title="Unsaved changes"
        description="Save your changes before closing?"
        cancelLabel="Continue editing"
        confirmLabel="Discard changes"
        destructive
        onCancel={() => setDiscard(false)}
        onConfirm={onClose}
        additionalAction={
          <V4Button variant="primary" onClick={() => void save()}>
            <SctSave />
            Save changes
          </V4Button>
        }
      />
    </V4Drawer>
  );
}
