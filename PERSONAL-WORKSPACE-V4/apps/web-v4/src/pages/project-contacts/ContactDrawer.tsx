import { useMemo, useRef, useState } from 'react';
import { useV4DirtySurface } from '../../components/interaction/V4DirtyGuard';
import { V4ConfirmDialog } from '../../components/common/V4ConfirmDialog';
import type { ProjectContact } from '@scli/domain';
import { V4Drawer } from '../../components/common/V4Drawer';
import { V4FilterSelect } from '../../components/common/V4FilterSelect';
import { V4Button } from '../../components/common/V4Button';
import { SctSave } from '../../components/common/SctIcons';

export interface ContactDraft {
  group?: string;
  notes?: string;
  archived?: boolean;
  name: string;
  email: string;
  company: string;
  role: string;
  phone: string;
  isPrimary: boolean;
}

const draftFor = (contact: ProjectContact | null): ContactDraft => ({
  ...(contact?.group ? { group: contact.group } : {}),
  ...(contact?.notes ? { notes: contact.notes } : {}),
  ...(contact?.archived !== undefined ? { archived: contact.archived } : {}),
  name: contact?.name ?? '',
  email: contact?.email ?? '',
  company: contact?.company ?? '',
  role: contact?.role ?? '',
  phone: contact?.phone ?? '',
  isPrimary: contact?.isPrimary ?? false,
});

interface ContactDrawerProps {
  initialGroup?: string;
  contacts?: readonly ProjectContact[];
  open: boolean;
  contact: ProjectContact | null;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (draft: ContactDraft) => Promise<boolean>;
}

export function ContactDrawer(props: ContactDrawerProps) {
  if (!props.open) return null;
  return <OpenContactDrawer {...props} />;
}

function OpenContactDrawer({
  contact,
  pending,
  error,
  onClose,
  onSave,
  contacts = [],
  initialGroup,
}: Omit<ContactDrawerProps, 'open'>) {
  const initial = useMemo(
    () => ({ ...draftFor(contact), ...(!contact && initialGroup ? { group: initialGroup } : {}) }),
    [contact, initialGroup],
  );
  const [draft, setDraft] = useState(initial);
  const [discarding, setDiscarding] = useState(false);
  const [confirmPrimary, setConfirmPrimary] = useState(false);
  const editing = Boolean(contact);
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
    draft.name.trim() &&
    (!draft.email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())),
  );
  const replacement = contacts.find(
    (other) =>
      other.id !== contact?.id &&
      other.isPrimary &&
      !other.archived &&
      (other.group || other.role || 'Unspecified').trim().toLowerCase() ===
        (draft.group || draft.role || 'Unspecified').trim().toLowerCase(),
  );
  const close = () => {
    if (!pending) {
      if (dirty) setDiscarding(true);
      else onClose();
    }
  };
  const update = <K extends keyof ContactDraft>(key: K, value: ContactDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const save = async () => {
    if (await onSave(draft)) {
      const next = navigation.current;
      navigation.current = null;
      next?.proceed();
    }
  };
  const requestSave = () => {
    if (draft.isPrimary && replacement) setConfirmPrimary(true);
    else void save();
  };

  return (
    <V4Drawer
      presentation="float"
      open
      className="v4-contacts__drawer"
      title={editing ? 'Edit Contact' : 'Add Contact'}
      description={
        editing
          ? 'Update contact details. The group controls where this contact appears; the role describes their responsibility.'
          : 'Add a project contact for coordination.'
      }
      onClose={close}
      dismissible={!pending}
      footer={
        <div className="v4-contacts__drawer-footer">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="v4-contacts__primary"
            disabled={!valid || pending}
            onClick={() => {
              requestSave();
            }}
          >
            {pending ? 'Saving…' : editing ? 'Save Changes' : 'Add Contact'}
          </button>
        </div>
      }
    >
      <V4ConfirmDialog
        open={confirmPrimary}
        title="Replace primary contact"
        description={`${replacement?.name ?? 'The existing contact'} is the Primary contact in this group. Make ${draft.name} Primary instead?`}
        cancelLabel="Keep editing"
        confirmLabel="Replace primary contact"
        pending={pending}
        onCancel={() => setConfirmPrimary(false)}
        onConfirm={() => void save()}
      />
      <V4ConfirmDialog
        open={discarding}
        destructive
        title="Unsaved contact changes"
        description="Save your changes before closing?"
        cancelLabel="Keep editing"
        confirmLabel="Discard"
        additionalAction={
          <V4Button
            variant="primary"
            disabled={!valid || pending}
            onClick={() => {
              setDiscarding(false);
              requestSave();
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
      <div className="v4-contacts__drawer-form">
        <section aria-labelledby="contact-identity-heading">
          <h3 id="contact-identity-heading">Identity</h3>
          <div className="v4-contacts__drawer-grid">
            <V4FilterSelect
              label="Contact group"
              value={draft.group ?? ''}
              onChange={(value) => update('group', value)}
              options={[
                { value: '', label: 'Choose a group' },
                ...['Client', 'Sales', 'Consultant', 'Contractor', 'Internal Team', 'Other'].map(
                  (value) => ({ value, label: value }),
                ),
              ]}
            />
            <label>
              <span>Full name *</span>
              <input
                value={draft.name}
                maxLength={180}
                placeholder="e.g. Aisha Rahman"
                onChange={(event) => update('name', event.target.value)}
              />
            </label>
            <label>
              <span>Role</span>
              <input
                value={draft.role}
                maxLength={120}
                placeholder="e.g. Project Manager (optional)"
                onChange={(event) => update('role', event.target.value)}
              />
            </label>
          </div>
        </section>
        <section aria-labelledby="contact-organization-heading">
          <h3 id="contact-organization-heading">Organization</h3>
          <label>
            <span>Company</span>
            <input
              value={draft.company}
              maxLength={300}
              placeholder="Organization (optional)"
              onChange={(event) => update('company', event.target.value)}
            />
          </label>
        </section>
        <section aria-labelledby="contact-communication-heading">
          <h3 id="contact-communication-heading">Communication</h3>
          <label>
            <span>Email (optional)</span>
            <input
              type="email"
              value={draft.email}
              maxLength={320}
              placeholder="name@company.com"
              onChange={(event) => update('email', event.target.value)}
            />
          </label>
          <label>
            <span>Phone</span>
            <input
              type="tel"
              maxLength={64}
              value={draft.phone}
              onChange={(event) => update('phone', event.target.value)}
            />
          </label>
          <label className="v4-contacts__primary-check">
            <input
              type="checkbox"
              checked={draft.isPrimary}
              onChange={(event) => update('isPrimary', event.target.checked)}
            />
            <span>Primary contact</span>
          </label>
        </section>
        {error ? (
          <p className="v4-contacts__mutation-error" role="alert">
            {error}
          </p>
        ) : null}
        <label>
          <span>Responsibility notes</span>
          <textarea
            maxLength={8000}
            value={draft.notes ?? ''}
            onChange={(event) => update('notes', event.target.value)}
          />
        </label>
      </div>
    </V4Drawer>
  );
}
