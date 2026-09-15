import { useState } from 'react';
import { V4FloatingWorkspace } from '../common/V4FloatingWorkspace';
import { V4Button } from '../common/V4Button';
import { SctSave } from '../common/SctIcons';

export function ProjectDirectoryEditor({
  kind,
  onSave,
  onClose,
  findExisting,
}: {
  kind: 'Client' | 'Manager' | 'Sales';
  onSave: (name: string, email: string) => Promise<void>;
  onClose: () => void;
  findExisting?: (name: string, email: string) => { name: string; select: () => void } | undefined;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [duplicate, setDuplicate] = useState<{ name: string; select: () => void } | null>(null);
  const close = () => {
    if (!pending) {
      if (name.trim() || email.trim()) setConfirm(true);
      else onClose();
    }
  };
  const save = async () => {
    const existing = findExisting?.(name, email);
    if (existing) {
      setDuplicate(existing);
      return;
    }
    setPending(true);
    setError('');
    try {
      await onSave(name.trim(), email.trim());
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save this entry.');
    } finally {
      setPending(false);
    }
  };
  return (
    <V4FloatingWorkspace
      open
      title={`Add ${kind === 'Sales' ? 'Sales contact' : kind.toLowerCase()}`}
      onRequestClose={close}
      dismissible={!pending}
      panelClassName="v4-editor-float"
      footer={
        <>
          <V4Button onClick={close} disabled={pending}>
            Cancel
          </V4Button>
          <V4Button
            variant="primary"
            leadingIcon={<SctSave />}
            type="submit"
            form="project-directory-editor"
            disabled={pending || !name.trim()}
          >
            Save and select
          </V4Button>
        </>
      }
    >
      <form
        id="project-directory-editor"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        className="v4-scope-edit"
      >
        <label className="v4-scope-edit__field">
          Name
          <input required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="v4-scope-edit__field">
          Email (optional)
          <input
            type="email"
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        {duplicate && (
          <div role="alert">
            <p>{duplicate.name} already exists. Use the existing entry?</p>
            <V4Button onClick={() => setDuplicate(null)}>Keep editing</V4Button>
            <V4Button
              variant="primary"
              onClick={() => {
                duplicate.select();
                onClose();
              }}
            >
              Use existing
            </V4Button>
          </div>
        )}
        {confirm && (
          <div role="alert">
            <p>Discard the unsaved contact?</p>
            <V4Button onClick={() => setConfirm(false)}>Continue editing</V4Button>
            <V4Button onClick={onClose}>Discard</V4Button>
          </div>
        )}
      </form>
    </V4FloatingWorkspace>
  );
}
