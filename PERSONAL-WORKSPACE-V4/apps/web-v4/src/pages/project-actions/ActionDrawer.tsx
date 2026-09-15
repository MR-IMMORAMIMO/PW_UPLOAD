import { createElement } from 'react';
import { SctSave, SctAdd, SctEdit, SctRemove, SctBack } from '../../components/common/SctIcons';
import { V4ConfirmDialog } from '../../components/common/V4ConfirmDialog';
import { V4DateInput } from '../../components/common/V4DateInput';
import { V4Button } from '../../components/common/V4Button';
import { useId, useRef, useState, type FormEvent } from 'react';
import { V4FilterSelect } from '../../components/common/V4FilterSelect';
import { ContactDrawer, type ContactDraft } from '../project-contacts/ContactDrawer';
import type { ProjectContact } from '@scli/domain';
import type {
  ActionCategory,
  ActionCategoryColorKey,
  ActionCategoryIconKey,
  ProjectActionItem,
  LuminaireRecord,
  ProjectReviewItem,
} from '@scli/domain';
import { V4Drawer } from '../../components/common/V4Drawer';
import {
  actionCategoryIconEntries,
  actionCategoryIconFor,
} from '../../components/common/actionCategoryIconCatalog';
import { actionStatusLabel } from './actionsViewModel';

export type ActionDraft = Pick<
  ProjectActionItem,
  | 'title'
  | 'details'
  | 'owner'
  | 'ownerRole'
  | 'dueDate'
  | 'status'
  | 'priority'
  | 'categoryId'
  | 'notes'
  | 'area'
  | 'luminaireId'
  | 'reviewItemId'
>;

export const actionStatuses: ProjectActionItem['status'][] = [
  'Open',
  'InProgress',
  'Waiting',
  'Completed',
  'Cancelled',
];

export const actionPriorities: ProjectActionItem['priority'][] = [
  'Low',
  'Normal',
  'High',
  'Urgent',
];

const emptyDraft = (): ActionDraft => ({
  title: '',
  details: '',
  owner: '',
  ownerRole: '',
  dueDate: null,
  status: 'Open',
  priority: 'Normal',
  categoryId: null,
  notes: '',
  area: '',
  luminaireId: null,
  reviewItemId: null,
});

export function ActionDrawer({
  action,
  categories,
  categoriesAvailable,
  saving,
  error,
  formTitle,
  formDescription,
  submitLabel,
  onCreateCategory,
  onUpdateCategory,
  onDeleteCategory,
  onRetryCategories,
  onClose,
  onSave,
  context,
  contacts = [],
  onCreateContact,
  meetings = [],
}: {
  action: ProjectActionItem | null;
  categories: readonly ActionCategory[];
  categoriesAvailable: boolean;
  saving: boolean;
  error: string | null;
  formTitle?: string;
  formDescription?: string;
  submitLabel?: string;
  onCreateCategory: (input: {
    label: string;
    iconKey: ActionCategoryIconKey;
    colorKey: ActionCategoryColorKey;
  }) => Promise<ActionCategory>;
  onUpdateCategory: (
    id: string,
    input: { label: string; iconKey: ActionCategoryIconKey; colorKey: ActionCategoryColorKey },
  ) => Promise<ActionCategory>;
  onDeleteCategory: (category: ActionCategory, replacementId?: string | null) => Promise<void>;
  onRetryCategories: () => void;
  onClose: () => void;
  onSave: (draft: ActionDraft, meetingId?: string) => void;
  meetings?: readonly { id: string; title: string }[];
  context?: { luminaires: readonly LuminaireRecord[]; reviews: readonly ProjectReviewItem[] };
  contacts?: ProjectContact[];
  onCreateContact?: (draft: ContactDraft) => Promise<ProjectContact>;
}) {
  type Mode =
    'ACTION_FORM' | 'CREATE_CATEGORY' | 'MANAGE_CATEGORIES' | 'EDIT_CATEGORY' | 'DELETE_CATEGORY';
  const [draft, setDraft] = useState<ActionDraft>(() =>
    action
      ? {
          title: action.title,
          details: action.details,
          owner: action.owner,
          ownerRole: action.ownerRole,
          dueDate: action.dueDate,
          status: action.status,
          priority: action.priority,
          categoryId: action.categoryId,
          notes: action.notes,
          area: action.area ?? '',
          luminaireId: action.luminaireId ?? null,
          reviewItemId: action.reviewItemId ?? null,
        }
      : emptyDraft(),
  );
  const [mode, setMode] = useState<Mode>('ACTION_FORM');
  const [meetingId, setMeetingId] = useState('');
  const formId = useId();
  const initial = useRef(JSON.stringify(draft));
  const [discarding, setDiscarding] = useState(false);
  const [addingContact, setAddingContact] = useState(false);
  const [contactPending, setContactPending] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);
  const close = () => {
    if (saving || contactPending || categorySaving) return;
    if (JSON.stringify(draft) !== initial.current || meetingId) setDiscarding(true);
    else onClose();
  };
  const [categoryDraft, setCategoryDraft] = useState({
    label: '',
    iconKey: 'tags' as ActionCategoryIconKey,
    colorKey: 'teal' as ActionCategoryColorKey,
  });
  const [categoryTarget, setCategoryTarget] = useState<ActionCategory | null>(null);
  const [replacementCategory, setReplacementCategory] = useState('');
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [categorySaving, setCategorySaving] = useState(false);
  const change = <K extends keyof ActionDraft>(key: K, value: ActionDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (draft.title.trim())
      onSave(
        {
          ...draft,
          title: draft.title.trim(),
          details: draft.details.trim(),
          owner: draft.owner.trim(),
        },
        meetingId || undefined,
      );
  };
  const categoryErrorCopy = (cause: unknown) =>
    cause instanceof Error && /409|duplicate|already exists/i.test(cause.message)
      ? 'A category with this name already exists.'
      : 'The category could not be saved. Please try again.';
  const saveCategory = async () => {
    if (!categoryDraft.label.trim()) return;
    setCategorySaving(true);
    setCategoryError(null);
    try {
      if (mode === 'CREATE_CATEGORY') {
        const created = await onCreateCategory({
          ...categoryDraft,
          label: categoryDraft.label.trim(),
        });
        setDraft((current) => ({ ...current, categoryId: created.id }));
        setMode('ACTION_FORM');
      } else if (mode === 'EDIT_CATEGORY' && categoryTarget) {
        await onUpdateCategory(categoryTarget.id, {
          ...categoryDraft,
          label: categoryDraft.label.trim(),
        });
        setMode('MANAGE_CATEGORIES');
      }
    } catch (cause) {
      setCategoryError(categoryErrorCopy(cause));
    } finally {
      setCategorySaving(false);
    }
  };
  const renderCategoryFields = () => (
    <>
      <label>
        Name{' '}
        <input
          required
          maxLength={80}
          value={categoryDraft.label}
          onChange={(event) =>
            setCategoryDraft((current) => ({ ...current, label: event.target.value }))
          }
        />
      </label>
      <fieldset className="v4-actions__picker">
        <legend>Icon</legend>
        <div className="v4-actions__icon-grid">
          {actionCategoryIconEntries.map((entry) => {
            const Icon = entry.icon;
            return (
              <V4Button
                key={entry.key}
                type="button"
                aria-label={entry.label}
                aria-pressed={categoryDraft.iconKey === entry.key}
                onClick={() => setCategoryDraft((current) => ({ ...current, iconKey: entry.key }))}
              >
                <Icon aria-hidden="true" />
                <span>{entry.label}</span>
              </V4Button>
            );
          })}
        </div>
      </fieldset>
      <fieldset className="v4-actions__picker">
        <legend>Color</legend>
        <div className="v4-actions__swatches">
          {(
            ['teal', 'blue', 'purple', 'gold', 'green', 'red', 'slate'] as ActionCategoryColorKey[]
          ).map((key) => (
            <V4Button
              key={key}
              type="button"
              className={`v4-actions__swatch v4-actions__swatch--${key}`}
              aria-label={`${key} color`}
              aria-pressed={categoryDraft.colorKey === key}
              onClick={() => setCategoryDraft((current) => ({ ...current, colorKey: key }))}
            />
          ))}
        </div>
      </fieldset>
      <div
        className={`v4-actions__category v4-actions__category--${categoryDraft.colorKey}`}
        aria-label="Category preview"
      >
        {createElement(actionCategoryIconFor(categoryDraft.iconKey), { 'aria-hidden': true })}
        {categoryDraft.label || 'Category preview'}
      </div>
    </>
  );
  return (
    <V4Drawer
      presentation="float"
      open
      title={
        mode === 'ACTION_FORM'
          ? action
            ? 'Edit Action'
            : (formTitle ?? 'Add Action')
          : mode === 'CREATE_CATEGORY'
            ? 'Create Category'
            : mode === 'EDIT_CATEGORY'
              ? 'Edit Category'
              : mode === 'DELETE_CATEGORY'
                ? 'Delete Category?'
                : 'Manage Categories'
      }
      description={
        mode === 'MANAGE_CATEGORIES'
          ? 'Categories are shared across all projects.'
          : mode === 'DELETE_CATEGORY'
            ? 'Choose how to classify existing actions when this shared category is removed.'
            : (formDescription ?? 'Track project work using the canonical action workspace.')
      }
      onClose={close}
      footer={
        mode === 'ACTION_FORM' ? (
          <div className="v4-actions__drawer-footer">
            <V4Button type="button" onClick={close}>
              Cancel
            </V4Button>
            <V4Button
              variant="primary"
              type="submit"
              form={formId}
              disabled={saving || !draft.title.trim()}
            >
              {action ? <SctSave /> : <SctAdd />}
              {action ? 'Save changes' : (submitLabel ?? 'Add action')}
            </V4Button>
          </div>
        ) : undefined
      }
    >
      <V4ConfirmDialog
        open={discarding}
        title="Unsaved action changes"
        description="Save your changes before closing?"
        cancelLabel="Continue editing"
        confirmLabel="Discard"
        destructive
        pending={saving}
        onCancel={() => setDiscarding(false)}
        onConfirm={onClose}
        additionalAction={
          <V4Button
            variant="primary"
            type="submit"
            form={formId}
            disabled={saving || !draft.title.trim()}
          >
            <SctSave />
            Save changes
          </V4Button>
        }
      />
      {addingContact && onCreateContact && (
        <ContactDrawer
          open
          contact={null}
          pending={contactPending}
          error={contactError}
          onClose={() => setAddingContact(false)}
          onSave={async (value) => {
            setContactPending(true);
            setContactError(null);
            try {
              const contact = await onCreateContact(value);
              setDraft((current) => ({ ...current, owner: contact.name, ownerRole: contact.role }));
              setAddingContact(false);
              return true;
            } catch (error) {
              setContactError(error instanceof Error ? error.message : 'Could not add contact.');
              return false;
            } finally {
              setContactPending(false);
            }
          }}
        />
      )}
      {mode === 'ACTION_FORM' ? (
        <form id={formId} className="v4-actions__form" onSubmit={submit}>
          <label>
            Title{' '}
            <input
              required
              maxLength={300}
              value={draft.title}
              onChange={(event) => change('title', event.target.value)}
            />
          </label>
          {
            <V4FilterSelect
              searchable
              label="Choose owner contact"
              value={contacts.find((contact) => contact.name === draft.owner)?.id ?? ''}
              onChange={(id) => {
                const contact = contacts.find((item) => item.id === id);
                if (!contact) {
                  setDraft((current) => ({ ...current, owner: '', ownerRole: '' }));
                  return;
                }
                if (contact)
                  setDraft((current) => ({
                    ...current,
                    owner: contact.name,
                    ownerRole: contact.role,
                  }));
              }}
              options={[
                { value: '', label: 'Choose a project contact' },
                ...contacts
                  .filter((contact) => !contact.archived)
                  .map((contact) => ({
                    value: contact.id,
                    label: `${contact.name}${contact.role ? ` · ${contact.role}` : ''}`,
                  })),
              ]}
            />
          }
          {onCreateContact && (
            <V4Button type="button" onClick={() => setAddingContact(true)}>
              <SctAdd /> Add owner contact
            </V4Button>
          )}
          <label>
            Details{' '}
            <textarea
              maxLength={8000}
              value={draft.details}
              onChange={(event) => change('details', event.target.value)}
            />
          </label>
          <label>
            Owner <input maxLength={180} value={draft.owner} readOnly />
          </label>
          <label>
            Owner Role <input maxLength={180} value={draft.ownerRole} readOnly />
          </label>
          <label>
            Due Date{' '}
            <V4DateInput
              type="date"
              value={draft.dueDate ?? ''}
              onChange={(event) => change('dueDate', event.target.value || null)}
            />
          </label>
          <label>
            Priority{' '}
            <select
              value={draft.priority}
              onChange={(event) =>
                change('priority', event.target.value as ActionDraft['priority'])
              }
            >
              {actionPriorities.map((value) => (
                <option key={value} value={value}>
                  {value === 'Normal' ? 'Medium' : value}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status{' '}
            <select
              value={draft.status}
              onChange={(event) => change('status', event.target.value as ActionDraft['status'])}
            >
              {actionStatuses.map((value) => (
                <option key={value} value={value}>
                  {actionStatusLabel(value)}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="v4-actions__category-field" disabled={!categoriesAvailable}>
            <legend>Category</legend>
            {categoriesAvailable ? (
              <>
                <V4FilterSelect
                  searchable
                  label="Category"
                  value={draft.categoryId ?? ''}
                  onChange={(id) => change('categoryId', id || null)}
                  options={[
                    { value: '', label: 'Uncategorized' },
                    ...categories.map((item) => ({
                      value: item.id,
                      label: item.label,
                      icon: (
                        <span className={`v4-actions__category--${item.colorKey}`}>
                          {createElement(actionCategoryIconFor(item.iconKey), {
                            'aria-hidden': true,
                          })}
                        </span>
                      ),
                    })),
                  ]}
                />
                <div className="v4-actions__category-actions">
                  <V4Button
                    type="button"
                    onClick={() => {
                      setCategoryDraft({ label: '', iconKey: 'tags', colorKey: 'teal' });
                      setCategoryError(null);
                      setMode('CREATE_CATEGORY');
                    }}
                  >
                    <SctAdd /> New Category
                  </V4Button>
                  <V4Button
                    type="button"
                    onClick={() => {
                      setCategoryError(null);
                      setMode('MANAGE_CATEGORIES');
                    }}
                  >
                    Manage Categories
                  </V4Button>
                </div>
              </>
            ) : (
              <p>Category catalog is unavailable. Retry it before changing category.</p>
            )}
          </fieldset>
          {!categoriesAvailable ? (
            <V4Button type="button" onClick={onRetryCategories}>
              Retry categories
            </V4Button>
          ) : null}
          <V4FilterSelect
            searchable
            label="Linked Meeting"
            value={meetingId}
            onChange={setMeetingId}
            options={[
              { value: '', label: 'None' },
              ...meetings.map((meeting) => ({ value: meeting.id, label: meeting.title })),
            ]}
          />
          {context ? (
            <>
              <label>
                Area
                <input
                  maxLength={500}
                  value={draft.area ?? ''}
                  onChange={(event) => change('area', event.target.value)}
                />
              </label>
              <label>
                Linked luminaire
                <select
                  aria-label="Linked luminaire"
                  value={draft.luminaireId ?? ''}
                  onChange={(event) => change('luminaireId', event.target.value || null)}
                >
                  <option value="">None</option>
                  {draft.luminaireId &&
                  !context.luminaires.some((item) => item.id === draft.luminaireId) ? (
                    <option value={draft.luminaireId}>Unavailable luminaire</option>
                  ) : null}
                  {context.luminaires.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.tag} · {item.description}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Linked comment
                <select
                  aria-label="Linked comment"
                  value={draft.reviewItemId ?? ''}
                  onChange={(event) => change('reviewItemId', event.target.value || null)}
                >
                  <option value="">None</option>
                  {draft.reviewItemId &&
                  !context.reviews.some((item) => item.id === draft.reviewItemId) ? (
                    <option value={draft.reviewItemId}>Unavailable comment</option>
                  ) : null}
                  {context.reviews.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}
          <label>
            Notes{' '}
            <textarea
              maxLength={8000}
              value={draft.notes}
              onChange={(event) => change('notes', event.target.value)}
            />
          </label>
          {error ? (
            <p role="alert" className="v4-actions__error">
              {error}
            </p>
          ) : null}
        </form>
      ) : mode === 'CREATE_CATEGORY' || mode === 'EDIT_CATEGORY' ? (
        <div className="v4-actions__form">
          <V4Button
            type="button"
            onClick={() =>
              setMode(mode === 'CREATE_CATEGORY' ? 'ACTION_FORM' : 'MANAGE_CATEGORIES')
            }
          >
            <SctBack /> Back
          </V4Button>
          {renderCategoryFields()}
          {categoryError ? (
            <p role="alert" className="v4-actions__error">
              {categoryError}
            </p>
          ) : null}
          <div className="v4-actions__drawer-footer">
            <V4Button
              className="v4-actions__secondary"
              type="button"
              onClick={() =>
                setMode(mode === 'CREATE_CATEGORY' ? 'ACTION_FORM' : 'MANAGE_CATEGORIES')
              }
            >
              Cancel
            </V4Button>
            <V4Button
              type="button"
              className="v4-actions__primary"
              disabled={categorySaving || !categoryDraft.label.trim()}
              onClick={() => void saveCategory()}
            >
              <SctSave /> {mode === 'CREATE_CATEGORY' ? 'Create Category' : 'Save Category'}
            </V4Button>
          </div>
        </div>
      ) : mode === 'MANAGE_CATEGORIES' ? (
        <div className="v4-actions__form">
          <V4Button type="button" onClick={() => setMode('ACTION_FORM')}>
            Back
          </V4Button>
          <p>Categories are shared across all projects.</p>
          {categories.map((item) => {
            const Icon = actionCategoryIconFor(item.iconKey);
            return (
              <div key={item.id} className="v4-actions__manager-row">
                <span className={`v4-actions__category v4-actions__category--${item.colorKey}`}>
                  <Icon aria-hidden="true" />
                  {item.label}
                </span>
                <span>
                  <V4Button
                    type="button"
                    onClick={() => {
                      setCategoryTarget(item);
                      setCategoryDraft({
                        label: item.label,
                        iconKey: item.iconKey,
                        colorKey: item.colorKey,
                      });
                      setCategoryError(null);
                      setMode('EDIT_CATEGORY');
                    }}
                  >
                    <SctEdit /> Edit
                  </V4Button>
                  <V4Button
                    type="button"
                    onClick={() => {
                      setCategoryTarget(item);
                      setReplacementCategory('');
                      setMode('DELETE_CATEGORY');
                    }}
                  >
                    <SctRemove /> Delete
                  </V4Button>
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="v4-actions__form">
          <p>Delete “{categoryTarget?.label}” category?</p>
          <V4FilterSelect
            label="Replacement category"
            value={replacementCategory}
            onChange={setReplacementCategory}
            options={[
              { value: '', label: 'Uncategorized' },
              ...categories
                .filter((item) => item.id !== categoryTarget?.id)
                .map((item) => ({ value: item.id, label: item.label })),
            ]}
          />
          <p>
            This category is shared across all projects. Existing actions retain their identity and
            use the replacement selected above.
          </p>
          {categoryError ? (
            <p role="alert" className="v4-actions__error">
              {categoryError}
            </p>
          ) : null}
          <div className="v4-actions__drawer-footer">
            <V4Button
              className="v4-actions__secondary"
              type="button"
              onClick={() => setMode('MANAGE_CATEGORIES')}
            >
              Cancel
            </V4Button>
            <V4Button
              type="button"
              className="v4-actions__danger"
              disabled={categorySaving || !categoryTarget}
              onClick={() => {
                if (!categoryTarget) return;
                setCategorySaving(true);
                setCategoryError(null);
                void onDeleteCategory(categoryTarget, replacementCategory || null)
                  .then(() => {
                    const baseline = JSON.parse(initial.current) as ActionDraft;
                    if (baseline.categoryId === categoryTarget.id)
                      initial.current = JSON.stringify({
                        ...baseline,
                        categoryId: replacementCategory || null,
                      });
                    setDraft((current) =>
                      current.categoryId === categoryTarget.id
                        ? { ...current, categoryId: replacementCategory || null }
                        : current,
                    );
                    setMode('MANAGE_CATEGORIES');
                  })
                  .catch((cause: unknown) => setCategoryError(categoryErrorCopy(cause)))
                  .finally(() => setCategorySaving(false));
              }}
            >
              Delete Category
            </V4Button>
          </div>
        </div>
      )}
    </V4Drawer>
  );
}
