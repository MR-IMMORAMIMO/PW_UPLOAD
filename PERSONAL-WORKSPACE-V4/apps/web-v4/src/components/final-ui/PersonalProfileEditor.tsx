import { useState, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { personalProfileSchema, type PersonalProfile } from '@scli/contracts';
import { apiRequest } from '../../api/environment';
import { V4FloatingWorkspace } from '../common/V4FloatingWorkspace';
import { V4Button } from '../common/V4Button';
import { SctCamera, SctSave } from '../common/SctIcons';
import { useV4DirtySurface } from '../interaction/V4DirtyGuard';
import { V4ConfirmDialog } from '../common/V4ConfirmDialog';

export function PersonalProfileEditor({
  profile,
  onClose,
}: {
  profile: PersonalProfile;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(profile);
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const queryClient = useQueryClient();
  const photoInput = useRef<HTMLInputElement>(null);
  const [leave, setLeave] = useState<{ proceed: () => void; cancel: () => void } | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(profile);
  const save = useMutation({
    mutationFn: () =>
      apiRequest<PersonalProfile>('/api/personal/profile', {
        method: 'PATCH',
        body: personalProfileSchema.parse(draft),
      }),
    onSuccess: (next) => {
      queryClient.setQueryData(['v4', 'personal-profile'], next);
      onClose();
      leave?.proceed();
    },
  });
  useV4DirtySurface(dirty, (_reason, proceed, cancel) => {
    if (reading || save.isPending) return cancel();
    setLeave({ proceed, cancel });
  });
  const close = () => {
    if (reading || save.isPending) return;
    if (dirty) setLeave({ proceed: onClose, cancel: () => {} });
    else onClose();
  };
  async function readPhoto(file?: File) {
    if (!file) return;
    setError('');
    setReading(true);
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5_000_000)
        throw new Error('Choose a PNG, JPG or WebP image smaller than 5 MB.');
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Image processing unavailable.');
      const edge = Math.min(bitmap.width, bitmap.height);
      context.drawImage(
        bitmap,
        (bitmap.width - edge) / 2,
        (bitmap.height - edge) / 2,
        edge,
        edge,
        0,
        0,
        256,
        256,
      );
      bitmap.close();
      setDraft((current) => ({ ...current, photo: canvas.toDataURL('image/webp', 0.88) }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Image could not be read.');
    } finally {
      setReading(false);
      if (photoInput.current) photoInput.current.value = '';
    }
  }
  return (
    <V4FloatingWorkspace
      open
      title="My Profile"
      description="Choose the name, email and avatar displayed in your workspace."
      panelClassName="v4-profile-editor"
      onRequestClose={close}
      dismissible={!save.isPending && !reading}
      footer={
        <V4Button
          onClick={() => save.mutate()}
          disabled={reading || save.isPending || !personalProfileSchema.safeParse(draft).success}
        >
          <SctSave size={18} /> {save.isPending ? 'Saving…' : 'Save Profile'}
        </V4Button>
      }
    >
      <V4ConfirmDialog
        open={Boolean(leave)}
        destructive
        title="Unsaved profile changes"
        description="Save your changes before closing?"
        cancelLabel="Keep editing"
        confirmLabel="Discard"
        pending={save.isPending}
        additionalAction={
          <V4Button
            disabled={reading || save.isPending || !personalProfileSchema.safeParse(draft).success}
            onClick={() => save.mutate()}
          >
            Save changes
          </V4Button>
        }
        onCancel={() => {
          leave?.cancel();
          setLeave(null);
        }}
        onConfirm={() => {
          const next = leave;
          setLeave(null);
          onClose();
          next?.proceed();
        }}
      />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!reading && !save.isPending && personalProfileSchema.safeParse(draft).success)
            save.mutate();
        }}
      >
        <label>
          Name
          <input
            autoComplete="name"
            value={draft.name}
            maxLength={120}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </label>
        <label>
          Email
          <input
            type="email"
            maxLength={254}
            autoComplete="email"
            value={draft.email}
            onChange={(event) => setDraft({ ...draft, email: event.target.value })}
          />
        </label>
        <div className="v4-profile-preview">
          {draft.photo ? (
            <img src={draft.photo} alt="Avatar preview" />
          ) : (
            draft.name
              .trim()
              .split(/\s+/)
              .map((part) => part[0])
              .join('')
              .toUpperCase()
          )}
        </div>
        <input
          ref={photoInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          aria-label="Choose avatar image"
          onChange={(event) => void readPhoto(event.target.files?.[0])}
        />
        <V4Button type="button" disabled={reading} onClick={() => photoInput.current?.click()}>
          <SctCamera size={18} />
          Choose Photo
        </V4Button>
        {draft.photo ? (
          <V4Button
            type="button"
            disabled={reading || save.isPending}
            onClick={() => setDraft({ ...draft, photo: null })}
          >
            Use Initials
          </V4Button>
        ) : null}
        {error || save.error ? <p role="alert">{error || save.error?.message}</p> : null}
      </form>
    </V4FloatingWorkspace>
  );
}
