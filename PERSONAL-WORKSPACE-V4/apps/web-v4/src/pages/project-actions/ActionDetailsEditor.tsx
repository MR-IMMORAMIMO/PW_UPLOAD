import { createElement, useState } from 'react';
import type {
  ActionCategory,
  ProjectActionItem,
  ProjectContact,
  LuminaireRecord,
} from '@scli/domain';
import { V4FloatingWorkspace } from '../../components/common/V4FloatingWorkspace';
import { V4Button } from '../../components/common/V4Button';
import { V4DateInput } from '../../components/common/V4DateInput';
import { V4FilterSelect } from '../../components/common/V4FilterSelect';
import { V4ConfirmDialog } from '../../components/common/V4ConfirmDialog';
import { SctSave } from '../../components/common/SctIcons';
import { actionCategoryIconFor } from '../../components/common/actionCategoryIconCatalog';

type Details = Pick<
  ProjectActionItem,
  'priority' | 'dueDate' | 'owner' | 'ownerRole' | 'categoryId' | 'area' | 'luminaireId'
>;
export function ActionDetailsEditor({
  action,
  contacts,
  categories,
  luminaires,
  onSave,
  onClose,
}: {
  action: ProjectActionItem;
  contacts: ProjectContact[];
  categories: ActionCategory[];
  luminaires: LuminaireRecord[];
  onSave: (draft: Details) => Promise<void>;
  onClose: () => void;
}) {
  const original: Details = {
    priority: action.priority,
    dueDate: action.dueDate,
    owner: action.owner,
    ownerRole: action.ownerRole,
    categoryId: action.categoryId,
    area: action.area ?? '',
    luminaireId: action.luminaireId ?? null,
  };
  const [draft, setDraft] = useState(original),
    [pending, setPending] = useState(false),
    [error, setError] = useState(''),
    [confirm, setConfirm] = useState(false);
  const change = <K extends keyof Details>(key: K, value: Details[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const close = () => {
    if (!pending) {
      if (JSON.stringify(draft) !== JSON.stringify(original)) setConfirm(true);
      else onClose();
    }
  };
  const save = async () => {
    setConfirm(false);
    setPending(true);
    setError('');
    try {
      await onSave(draft);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save details.');
    } finally {
      setPending(false);
    }
  };
  return (
    <V4FloatingWorkspace
      open
      title="Action details"
      panelClassName="v4-action-details-editor"
      onRequestClose={close}
      dismissible={!pending}
      footer={
        <>
          <V4Button disabled={pending} onClick={close}>
            Cancel
          </V4Button>
          <V4Button variant="primary" disabled={pending} onClick={() => void save()}>
            <SctSave />
            Save changes
          </V4Button>
        </>
      }
    >
      <div className="v4-actions__form">
        <V4FilterSelect
          label="Priority"
          value={draft.priority}
          onChange={(value) => change('priority', value as Details['priority'])}
          options={['Low', 'Normal', 'High', 'Urgent'].map((value) => ({
            value,
            label: value === 'Normal' ? 'Medium' : value,
          }))}
        />
        <label htmlFor="action-details-due">
          Due Date
          <V4DateInput
            id="action-details-due"
            value={draft.dueDate ?? ''}
            onChange={(event) => change('dueDate', event.target.value || null)}
          />
        </label>
        <V4FilterSelect
          searchable
          label="Owner"
          value={contacts.find((contact) => contact.name === draft.owner)?.id ?? ''}
          onChange={(id) => {
            const contact = contacts.find((item) => item.id === id);
            setDraft((current) => ({
              ...current,
              owner: contact?.name ?? '',
              ownerRole: contact?.role ?? '',
            }));
          }}
          options={[
            { value: '', label: draft.owner || 'Unassigned' },
            ...contacts
              .filter((item) => !item.archived)
              .map((item) => ({ value: item.id, label: item.name })),
          ]}
        />
        <label>
          Owner Role
          <input readOnly value={draft.ownerRole} />
        </label>
        <V4FilterSelect
          searchable
          label="Category"
          value={draft.categoryId ?? ''}
          onChange={(value) => change('categoryId', value || null)}
          options={[
            { value: '', label: 'Uncategorized' },
            ...categories.map((item) => ({
              value: item.id,
              label: item.label,
              icon: (
                <span className={`v4-actions__category--${item.colorKey}`}>
                  {createElement(actionCategoryIconFor(item.iconKey))}
                </span>
              ),
            })),
          ]}
        />
        <label>
          Area
          <input
            maxLength={500}
            value={draft.area ?? ''}
            onChange={(event) => change('area', event.target.value)}
          />
        </label>
        <V4FilterSelect
          searchable
          label="Linked luminaire"
          value={draft.luminaireId ?? ''}
          onChange={(value) => change('luminaireId', value || null)}
          options={[
            { value: '', label: 'None' },
            ...luminaires.map((item) => ({
              value: item.id,
              label: `${item.tag} · ${item.description}`,
            })),
          ]}
        />
      </div>
      {error && <p role="alert">{error}</p>}
      <V4ConfirmDialog
        open={confirm}
        title="Unsaved action details"
        description="Save your changes before closing?"
        cancelLabel="Continue editing"
        confirmLabel="Discard"
        destructive
        onCancel={() => setConfirm(false)}
        onConfirm={onClose}
        additionalAction={
          <V4Button variant="primary" onClick={() => void save()}>
            <SctSave />
            Save changes
          </V4Button>
        }
      />
    </V4FloatingWorkspace>
  );
}
