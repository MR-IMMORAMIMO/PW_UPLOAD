import { useV4DirtySurface } from '../../components/interaction/V4DirtyGuard';
import { v4Decisions } from '../../components/interaction/V4Decisions';
import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Eye,
  FolderPlus,
  Folder,
  SctBack,
  Pencil,
  Plus,
  Power,
  Save,
  Trash2,
  Upload,
} from '../../components/common/SctIcons';
import type { ProfileFolderNodeDraftInput } from '@scli/contracts';
import {
  actionCategoryIconKeys,
  v4PaletteColorKeys,
  type ActionCategory,
  type ActionCategoryColorKey,
  type ActionCategoryIconKey,
  type AppUser,
  type FolderNodePreset,
  type FolderProfile,
  type FolderProfilePreset,
  type FolderProfileRef,
  type ProjectType,
} from '@scli/domain';
import type { FolderProfileCatalogResponse } from '@scli/api-client';
import { V4Drawer } from '../../components/common/V4Drawer';
import {
  actionCategoryIconEntries,
  actionCategoryIconFor,
} from '../../components/common/actionCategoryIconCatalog';
import {
  blankFolderProfileDraft,
  folderProfileToDraft,
  folderRefValue,
  initials,
  type FolderProfileDraft,
  validateProjectTypes,
} from './settingsModel';

type Busy = boolean;

function ErrorText({ value }: { value: string | null }) {
  return value ? (
    <p className="v4-settings__inline-error" role="alert">
      {value}
    </p>
  ) : null;
}

export function ProjectTypesDrawer({
  open,
  serverError,
  onClose,
  types,
  busy,
  onSave,
}: {
  open: boolean;
  serverError?: string | undefined;
  onClose: () => void;
  types: ProjectType[];
  busy: Busy;
  onSave: (types: ProjectType[]) => void;
}) {
  const [draft, setDraft] = useState(types);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(types), [types, open]);
  const changed = JSON.stringify(draft) !== JSON.stringify(types) || Boolean(newName.trim());
  const close = async () => {
    if (!busy && (!changed || (await v4Decisions.confirm('Discard unsaved project types?'))))
      onClose();
  };
  useV4DirtySurface(open && changed, (_reason, proceed, cancel) => {
    if (busy) return cancel();
    void v4Decisions
      .confirm('Discard unsaved project types?')
      .then((ok) => (ok ? proceed() : cancel()));
  });
  const add = () => {
    const name = newName.trim();
    if (!name) return setError('Project type name is required.');
    const now = new Date().toISOString();
    const next = [
      ...draft,
      { id: crypto.randomUUID(), name, isActive: true, createdAt: now, updatedAt: now },
    ];
    const validation = validateProjectTypes(next);
    if (validation) return setError(validation);
    setDraft(next);
    setNewName('');
    setError(null);
  };
  const save = () => {
    const validation = validateProjectTypes(draft);
    if (validation) return setError(validation);
    setError(null);
    onSave(draft.map((type) => ({ ...type, name: type.name.trim() })));
  };
  return (
    <V4Drawer
      presentation="float"
      open={open}
      title="Project Types"
      description="Names remain attached to historical projects; inactive types disappear only from future selection."
      onClose={() => void close()}
      className="v4-settings-drawer"
      footer={
        <button className="v4-settings__primary" type="button" disabled={busy} onClick={save}>
          <Save aria-hidden="true" /> Save Project Types
        </button>
      }
    >
      <ErrorText value={serverError ?? null} />
      <div className="v4-settings__add-row">
        <label>
          <span>New project type</span>
          <input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                add();
              }
            }}
          />
        </label>
        <button type="button" onClick={add}>
          <Plus aria-hidden="true" /> Add
        </button>
      </div>
      <ErrorText value={error} />
      <div className="v4-settings__manage-list">
        {draft.map((type) => (
          <div className="v4-settings__manage-row" key={type.id}>
            <input
              aria-label={`Project type ${type.name}`}
              value={type.name}
              onChange={(event) =>
                setDraft((current) =>
                  current.map((item) =>
                    item.id === type.id
                      ? { ...item, name: event.target.value, updatedAt: new Date().toISOString() }
                      : item,
                  ),
                )
              }
            />
            <span className={`v4-settings__state ${type.isActive ? 'is-active' : ''}`}>
              {type.isActive ? 'Active' : 'Inactive'}
            </span>
            <button
              type="button"
              aria-label={`${type.isActive ? 'Deactivate' : 'Reactivate'} ${type.name}`}
              onClick={() => {
                if (type.isActive && draft.filter((item) => item.isActive).length === 1)
                  return setError('At least one project type must remain active.');
                setError(null);
                setDraft((current) =>
                  current.map((item) =>
                    item.id === type.id
                      ? { ...item, isActive: !item.isActive, updatedAt: new Date().toISOString() }
                      : item,
                  ),
                );
              }}
            >
              <Power aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </V4Drawer>
  );
}

function mutateNode(
  nodes: ProfileFolderNodeDraftInput[],
  path: number[],
  mutate: (node: ProfileFolderNodeDraftInput) => ProfileFolderNodeDraftInput | null,
): ProfileFolderNodeDraftInput[] {
  const [head, ...tail] = path;
  if (head === undefined) return nodes;
  return nodes.flatMap((node, index) => {
    if (index !== head) return [node];
    if (tail.length === 0) {
      const next = mutate(node);
      return next ? [next] : [];
    }
    return [{ ...node, children: mutateNode(node.children, tail, mutate) }];
  });
}

function FolderNodesEditor({
  nodes,
  path = [],
  onChange,
}: {
  nodes: ProfileFolderNodeDraftInput[];
  path?: number[];
  onChange: (nodes: ProfileFolderNodeDraftInput[]) => void;
}) {
  return (
    <div className="v4-settings__folder-tree">
      {nodes.map((node, index) => {
        const nodePath = [...path, index];
        return (
          <div
            className="v4-settings__folder-node"
            key={node.profileFolderId ?? nodePath.join('-')}
          >
            <div>
              <input
                aria-label="Folder name"
                value={node.name}
                onChange={(event) =>
                  onChange(
                    mutateNode(nodes, [index], (item) => ({ ...item, name: event.target.value })),
                  )
                }
              />
              <button
                type="button"
                aria-label={`Add child to ${node.name}`}
                onClick={() =>
                  onChange(
                    mutateNode(nodes, [index], (item) => ({
                      ...item,
                      children: [
                        ...item.children,
                        { name: 'New folder', semanticRole: null, children: [] },
                      ],
                    })),
                  )
                }
              >
                <FolderPlus aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={`Remove ${node.name}`}
                disabled={nodes.length === 1 && path.length === 0}
                onClick={() => onChange(mutateNode(nodes, [index], () => null))}
              >
                <Trash2 aria-hidden="true" />
              </button>
            </div>
            {node.children.length ? (
              <FolderNodesEditor
                nodes={node.children}
                path={nodePath}
                onChange={(children) =>
                  onChange(mutateNode(nodes, [index], (item) => ({ ...item, children })))
                }
              />
            ) : null}
          </div>
        );
      })}
      <button
        className="v4-settings__tree-add"
        type="button"
        onClick={() =>
          onChange([...nodes, { name: 'New folder', semanticRole: null, children: [] }])
        }
      >
        <Plus aria-hidden="true" /> Add folder
      </button>
    </div>
  );
}

function PresetTree({ folders }: { folders: FolderNodePreset[] }) {
  return (
    <ul className="v4-settings__preview-tree">
      {folders.map((folder) => (
        <li key={folder.name}>
          <span>
            <Folder aria-hidden="true" />
            {folder.name}
          </span>
          {folder.children.length ? <PresetTree folders={folder.children} /> : null}
        </li>
      ))}
    </ul>
  );
}

function DraftTree({ folders }: { folders: ProfileFolderNodeDraftInput[] }) {
  return (
    <ul className="v4-settings__preview-tree">
      {folders.map((folder, index) => (
        <li key={folder.profileFolderId ?? `${folder.name}-${index}`}>
          <span>
            <Folder aria-hidden="true" />
            {folder.name}
          </span>
          {folder.children.length ? <DraftTree folders={folder.children} /> : null}
        </li>
      ))}
    </ul>
  );
}

type ProfilePanel =
  | { kind: 'list' }
  | { kind: 'preview'; name: string; preset?: FolderProfilePreset; profile?: FolderProfile }
  | { kind: 'edit'; profileId: string | null; draft: FolderProfileDraft };

export function FolderProfilesDrawer({
  open,
  serverError,
  onClose,
  presets,
  catalog,
  busy,
  onCreate,
  onUpdate,
  onDuplicate,
  onImport,
  onDelete,
  onSetDefault,
}: {
  open: boolean;
  serverError?: string | undefined;
  onClose: () => void;
  presets: FolderProfilePreset[];
  catalog: FolderProfileCatalogResponse;
  busy: Busy;
  onCreate: (draft: FolderProfileDraft) => void;
  onUpdate: (profileId: string, draft: FolderProfileDraft) => void;
  onDuplicate: (profileId: string) => void;
  onImport: (name: string) => void;
  onDelete: (profileId: string) => void;
  onSetDefault: (ref: FolderProfileRef) => void;
}) {
  const [panel, setPanel] = useState<ProfilePanel>({ kind: 'list' });
  const [importName, setImportName] = useState('');
  useEffect(() => {
    if (!open) setPanel({ kind: 'list' });
  }, [open]);
  const initialDraft =
    panel.kind === 'edit' && panel.profileId
      ? catalog.profiles.find((p) => p.profileId === panel.profileId)
      : null;
  const changed =
    panel.kind === 'edit' &&
    JSON.stringify(panel.draft) !==
      JSON.stringify(initialDraft ? folderProfileToDraft(initialDraft) : blankFolderProfileDraft());
  const back = async () => {
    if (!busy && (!changed || (await v4Decisions.confirm('Discard unsaved folder profile?'))))
      setPanel({ kind: 'list' });
  };
  useV4DirtySurface(open && changed, (_reason, proceed, cancel) => {
    if (busy) return cancel();
    void v4Decisions
      .confirm('Discard unsaved folder profile?')
      .then((ok) => (ok ? proceed() : cancel()));
  });
  const factory = presets.filter((item) => item.source === 'factory');
  const legacy = presets.filter((item) => item.source === 'legacy');
  const title =
    panel.kind === 'list'
      ? 'Folder Profiles'
      : panel.kind === 'preview'
        ? `Preview — ${panel.name}`
        : panel.profileId
          ? 'Edit Folder Profile'
          : 'Create Folder Profile';
  const editorFooter =
    panel.kind === 'edit' ? (
      <button
        className="v4-settings__primary"
        type="button"
        disabled={busy || !panel.draft.name.trim()}
        onClick={() =>
          panel.profileId ? onUpdate(panel.profileId, panel.draft) : onCreate(panel.draft)
        }
      >
        <ErrorText value={serverError ?? null} />
        <Save aria-hidden="true" /> Save Profile
      </button>
    ) : undefined;
  return (
    <V4Drawer
      presentation="float"
      open={open}
      title={title}
      description="Choose the default structure for new projects, or manage your folder templates."
      onClose={panel.kind === 'list' ? onClose : () => void back()}
      className="v4-settings-drawer v4-settings-drawer--wide"
      footer={
        <>
          {panel.kind !== 'list' && (
            <button type="button" disabled={busy} onClick={() => void back()}>
              <SctBack aria-hidden="true" /> Back to profiles
            </button>
          )}
          {editorFooter}
        </>
      }
    >
      {panel.kind === 'preview' ? (
        panel.profile ? (
          <DraftTree folders={folderProfileToDraft(panel.profile).folders} />
        ) : panel.preset ? (
          <PresetTree folders={panel.preset.folders} />
        ) : null
      ) : panel.kind === 'edit' ? (
        <div className="v4-settings__profile-editor">
          <label>
            <span>Profile name</span>
            <input
              value={panel.draft.name}
              onChange={(event) =>
                setPanel({ ...panel, draft: { ...panel.draft, name: event.target.value } })
              }
            />
          </label>
          <label>
            <span>Description</span>
            <textarea
              value={panel.draft.description}
              onChange={(event) =>
                setPanel({ ...panel, draft: { ...panel.draft, description: event.target.value } })
              }
            />
          </label>
          <fieldset>
            <legend>Folder structure</legend>
            <FolderNodesEditor
              nodes={panel.draft.folders}
              onChange={(folders) => setPanel({ ...panel, draft: { ...panel.draft, folders } })}
            />
          </fieldset>
          <fieldset>
            <legend>Output defaults</legend>
            {panel.draft.outputDefaults.map((output, index) => (
              <div className="v4-settings__output-row" key={index}>
                <label>
                  <span>Output type</span>
                  <input
                    aria-label="Output type"
                    placeholder="e.g. schedulePdf"
                    value={output.outputTypeId}
                    onChange={(event) =>
                      setPanel({
                        ...panel,
                        draft: {
                          ...panel.draft,
                          outputDefaults: panel.draft.outputDefaults.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, outputTypeId: event.target.value }
                              : item,
                          ),
                        },
                      })
                    }
                  />
                </label>
                <label>
                  <span>Destination folder</span>
                  <input
                    aria-label="Destination path"
                    placeholder="Relative folder path, e.g. 03_DRAWINGS/PDF"
                    value={output.destinationPath}
                    onChange={(event) =>
                      setPanel({
                        ...panel,
                        draft: {
                          ...panel.draft,
                          outputDefaults: panel.draft.outputDefaults.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, destinationPath: event.target.value }
                              : item,
                          ),
                        },
                      })
                    }
                  />
                </label>
                <button
                  type="button"
                  aria-label="Remove output default"
                  onClick={() =>
                    setPanel({
                      ...panel,
                      draft: {
                        ...panel.draft,
                        outputDefaults: panel.draft.outputDefaults.filter(
                          (_, itemIndex) => itemIndex !== index,
                        ),
                      },
                    })
                  }
                >
                  <Trash2 aria-hidden="true" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                setPanel({
                  ...panel,
                  draft: {
                    ...panel.draft,
                    outputDefaults: [
                      ...panel.draft.outputDefaults,
                      { outputTypeId: '', destinationPath: '' },
                    ],
                  },
                })
              }
            >
              <Plus aria-hidden="true" /> Add output default
            </button>
          </fieldset>
        </div>
      ) : (
        <>
          <div className="v4-settings__drawer-toolbar">
            <button
              type="button"
              onClick={() =>
                setPanel({ kind: 'edit', profileId: null, draft: blankFolderProfileDraft() })
              }
            >
              <Plus aria-hidden="true" /> Create Profile
            </button>
          </div>
          <h3>Factory profiles</h3>
          <div className="v4-settings__manage-list">
            {factory.map((preset) => {
              const ref: FolderProfileRef = {
                kind: 'factory',
                factoryProfileKey: preset.factoryProfileKey ?? '',
              };
              const selected = folderRefValue(catalog.defaultProfileRef) === folderRefValue(ref);
              return (
                <div
                  className="v4-settings__manage-row v4-settings__manage-row--profile"
                  key={preset.factoryProfileKey ?? preset.name}
                >
                  <span className="v4-settings__row-main">
                    <strong>{preset.name}</strong>
                    <small>Factory · read-only</small>
                  </span>
                  {selected ? (
                    <span className="v4-settings__default">
                      <Check aria-hidden="true" /> Default
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={!preset.factoryProfileKey || busy}
                      onClick={() => onSetDefault(ref)}
                    >
                      Set Default
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={`Preview ${preset.name}`}
                    onClick={() => setPanel({ kind: 'preview', name: preset.name, preset })}
                  >
                    <Eye aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>
          <h3>User profiles</h3>
          <div className="v4-settings__manage-list">
            {catalog.profiles.length ? (
              catalog.profiles.map((profile) => {
                const selected =
                  catalog.defaultProfileRef.kind === 'user' &&
                  catalog.defaultProfileRef.profileId === profile.profileId;
                return (
                  <div
                    className="v4-settings__manage-row v4-settings__manage-row--profile"
                    key={profile.profileId}
                  >
                    <span className="v4-settings__row-main">
                      <strong>{profile.name}</strong>
                      <small>{profile.description || 'Custom profile'}</small>
                    </span>
                    {selected ? (
                      <span className="v4-settings__default">
                        <Check aria-hidden="true" /> Default
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onSetDefault({ kind: 'user', profileId: profile.profileId })}
                      >
                        Set Default
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label={`Preview ${profile.name}`}
                      onClick={() => setPanel({ kind: 'preview', name: profile.name, profile })}
                    >
                      <Eye aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Edit ${profile.name}`}
                      onClick={() =>
                        setPanel({
                          kind: 'edit',
                          profileId: profile.profileId,
                          draft: folderProfileToDraft(profile),
                        })
                      }
                    >
                      <Pencil aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Duplicate ${profile.name}`}
                      disabled={busy}
                      onClick={() => onDuplicate(profile.profileId)}
                    >
                      <Copy aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${profile.name}`}
                      disabled={busy || selected}
                      onClick={async () => {
                        if (
                          await v4Decisions.confirm(
                            `Delete ${profile.name}? Projects already created from it retain their stored structure.`,
                          )
                        )
                          onDelete(profile.profileId);
                      }}
                    >
                      <Trash2 aria-hidden="true" />
                    </button>
                  </div>
                );
              })
            ) : (
              <p className="v4-settings__empty">No user profiles yet.</p>
            )}
          </div>
          {legacy.length ? (
            <>
              <h3>Legacy profiles</h3>
              <div className="v4-settings__manage-list">
                {legacy.map((preset) => (
                  <div
                    className="v4-settings__manage-row v4-settings__manage-row--profile"
                    key={preset.name}
                  >
                    <span className="v4-settings__row-main">
                      <strong>{preset.name}</strong>
                      <small>Import creates a new canonical identity.</small>
                    </span>
                    <button
                      type="button"
                      aria-label={`Preview ${preset.name}`}
                      onClick={() => setPanel({ kind: 'preview', name: preset.name, preset })}
                    >
                      <Eye aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setImportName(`${preset.name} (Imported)`);
                        onImport(`${preset.name} (Imported)`);
                      }}
                    >
                      <Upload aria-hidden="true" /> Import
                    </button>
                  </div>
                ))}
              </div>
            </>
          ) : null}
          {importName ? <span className="v4-visually-hidden">Importing {importName}</span> : null}
        </>
      )}
    </V4Drawer>
  );
}

type CategoryDraft = {
  label: string;
  iconKey: ActionCategoryIconKey;
  colorKey: ActionCategoryColorKey;
};
const blankCategory: CategoryDraft = {
  label: '',
  iconKey: actionCategoryIconKeys[0],
  colorKey: v4PaletteColorKeys[0],
};

export function ActionCategoriesDrawer({
  open,
  serverError,
  onClose,
  categories,
  busy,
  onCreate,
  onUpdate,
  onDelete,
}: {
  open: boolean;
  serverError?: string | undefined;
  onClose: () => void;
  categories: ActionCategory[];
  busy: Busy;
  onCreate: (draft: CategoryDraft) => void;
  onUpdate: (id: string, draft: CategoryDraft) => void;
  onDelete: (category: ActionCategory) => void;
}) {
  const [editing, setEditing] = useState<ActionCategory | 'new' | null>(null);
  const [draft, setDraft] = useState<CategoryDraft>(blankCategory);
  useEffect(() => {
    if (!open) setEditing(null);
  }, [open]);
  const changed =
    Boolean(editing) &&
    JSON.stringify(draft) !==
      JSON.stringify(
        editing === 'new' || !editing
          ? blankCategory
          : { label: editing.label, iconKey: editing.iconKey, colorKey: editing.colorKey },
      );
  const close = async () => {
    if (busy || (changed && !(await v4Decisions.confirm('Discard unsaved category?')))) return;
    if (editing) setEditing(null);
    else onClose();
  };
  useV4DirtySurface(open && changed, (_reason, proceed, cancel) => {
    if (busy) return cancel();
    void v4Decisions.confirm('Discard unsaved category?').then((ok) => (ok ? proceed() : cancel()));
  });
  const start = (value: ActionCategory | 'new') => {
    setEditing(value);
    setDraft(
      value === 'new'
        ? blankCategory
        : { label: value.label, iconKey: value.iconKey, colorKey: value.colorKey },
    );
  };
  return (
    <V4Drawer
      presentation="float"
      open={open}
      title={
        editing
          ? editing === 'new'
            ? 'Add Action Category'
            : 'Edit Action Category'
          : 'Action Categories'
      }
      description="Shared categories use the approved semantic icon and colour catalogues."
      onClose={() => void close()}
      className="v4-settings-drawer"
      footer={
        editing ? (
          <button
            className="v4-settings__primary"
            type="button"
            disabled={busy || !draft.label.trim()}
            onClick={() => (editing === 'new' ? onCreate(draft) : onUpdate(editing.id, draft))}
          >
            <ErrorText value={serverError ?? null} />
            <Save aria-hidden="true" /> Save Category
          </button>
        ) : undefined
      }
    >
      {editing ? (
        <div className="v4-settings__category-editor">
          <label>
            <span>Label</span>
            <input
              value={draft.label}
              onChange={(event) => setDraft({ ...draft, label: event.target.value })}
            />
          </label>
          <fieldset>
            <legend>Icon</legend>
            <div className="v4-settings__icon-grid">
              {actionCategoryIconEntries.map((entry) => {
                const Icon = entry.icon;
                return (
                  <button
                    type="button"
                    className={draft.iconKey === entry.key ? 'is-selected' : ''}
                    aria-label={entry.label}
                    title={entry.label}
                    key={entry.key}
                    onClick={() => setDraft({ ...draft, iconKey: entry.key })}
                  >
                    <Icon aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </fieldset>
          <fieldset>
            <legend>Colour</legend>
            <div className="v4-settings__color-grid">
              {v4PaletteColorKeys.map((color) => (
                <button
                  type="button"
                  className={`v4-settings__color v4-settings__color--${color} ${draft.colorKey === color ? 'is-selected' : ''}`}
                  aria-label={color}
                  key={color}
                  onClick={() => setDraft({ ...draft, colorKey: color })}
                >
                  {draft.colorKey === color ? <Check aria-hidden="true" /> : null}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
      ) : (
        <>
          <div className="v4-settings__drawer-toolbar">
            <button type="button" onClick={() => start('new')}>
              <Plus aria-hidden="true" /> Add Category
            </button>
          </div>
          <div className="v4-settings__manage-list">
            {categories.map((category) => {
              const Icon = actionCategoryIconFor(category.iconKey);
              return (
                <div className="v4-settings__manage-row" key={category.id}>
                  <span
                    className={`v4-settings__category-mark v4-settings__color--${category.colorKey}`}
                  >
                    <Icon aria-hidden="true" />
                  </span>
                  <span className="v4-settings__row-main">
                    <strong>{category.label}</strong>
                    <small>Sort order {category.sortOrder}</small>
                  </span>
                  <button
                    type="button"
                    aria-label={`Edit ${category.label}`}
                    onClick={() => start(category)}
                  >
                    <Pencil aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${category.label}`}
                    disabled={busy}
                    onClick={() => onDelete(category)}
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </V4Drawer>
  );
}

export function SalesDirectoryDrawer({
  open,
  serverError,
  onClose,
  users,
  busy,
  onCreate,
  onUpdate,
}: {
  open: boolean;
  serverError?: string | undefined;
  onClose: () => void;
  users: AppUser[];
  busy: Busy;
  onCreate: (input: { displayName: string; email?: string }) => void;
  onUpdate: (id: string, input: { displayName: string; email: string; isActive: boolean }) => void;
}) {
  const [editing, setEditing] = useState<AppUser | 'new' | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [active, setActive] = useState(true);
  const sorted = useMemo(
    () =>
      users.toSorted(
        (a, b) =>
          Number(b.isActive) - Number(a.isActive) || a.displayName.localeCompare(b.displayName),
      ),
    [users],
  );
  const changed =
    Boolean(editing) &&
    (editing === 'new'
      ? Boolean(name || email || !active)
      : Boolean(
          editing &&
          (name !== editing.displayName || email !== editing.email || active !== editing.isActive),
        ));
  const close = async () => {
    if (busy || (changed && !(await v4Decisions.confirm('Discard unsaved sales contact?')))) return;
    if (editing) setEditing(null);
    else onClose();
  };
  useV4DirtySurface(open && changed, (_reason, proceed, cancel) => {
    if (busy) return cancel();
    void v4Decisions
      .confirm('Discard unsaved sales contact?')
      .then((ok) => (ok ? proceed() : cancel()));
  });
  const start = (value: AppUser | 'new') => {
    setEditing(value);
    setName(value === 'new' ? '' : value.displayName);
    setEmail(value === 'new' ? '' : value.email);
    setActive(value === 'new' ? true : value.isActive);
  };
  useEffect(() => {
    if (!open) setEditing(null);
  }, [open]);
  return (
    <V4Drawer
      presentation="float"
      open={open}
      title={
        editing
          ? editing === 'new'
            ? 'Add Sales Contact'
            : 'Edit Sales Contact'
          : 'Sales Directory'
      }
      description="Manage the people available as Sales Owner. Email is optional."
      onClose={() => void close()}
      className={editing ? 'v4-settings-drawer v4-settings-sales-editor' : 'v4-settings-drawer'}
      footer={
        editing ? (
          <button
            className="v4-settings__primary"
            type="button"
            disabled={busy || !name.trim()}
            onClick={() =>
              editing === 'new'
                ? onCreate({
                    displayName: name.trim(),
                    ...(email.trim() ? { email: email.trim() } : {}),
                  })
                : onUpdate(editing.id, {
                    displayName: name.trim(),
                    email: email.trim(),
                    isActive: active,
                  })
            }
          >
            <ErrorText value={serverError ?? null} />
            <Save aria-hidden="true" /> Save Sales Contact
          </button>
        ) : undefined
      }
    >
      {editing ? (
        <div className="v4-settings__sales-editor">
          <label>
            <span>Name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            <span>Email (optional)</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Optional for a new local contact"
            />
          </label>
          {editing !== 'new' ? (
            <label className="v4-settings__check">
              <input
                type="checkbox"
                checked={active}
                onChange={(event) => setActive(event.target.checked)}
              />
              <span>Active for future project assignment</span>
            </label>
          ) : null}
        </div>
      ) : (
        <>
          <div className="v4-settings__drawer-toolbar">
            <button type="button" onClick={() => start('new')}>
              <Plus aria-hidden="true" /> Add Sales Contact
            </button>
          </div>
          <div className="v4-settings__manage-list">
            {sorted.length ? (
              sorted.map((user) => (
                <div className="v4-settings__manage-row" key={user.id}>
                  <span className="v4-settings__avatar">{initials(user.displayName)}</span>
                  <span className="v4-settings__row-main">
                    <strong>{user.displayName}</strong>
                    <small>{user.email}</small>
                  </span>
                  <span className={`v4-settings__state ${user.isActive ? 'is-active' : ''}`}>
                    {user.isActive ? 'Active' : 'Inactive'}
                  </span>
                  <button
                    type="button"
                    aria-label={`Edit ${user.displayName}`}
                    onClick={() => start(user)}
                  >
                    <Pencil aria-hidden="true" />
                  </button>
                </div>
              ))
            ) : (
              <p className="v4-settings__empty">
                No Sales identities yet. Add one here for future project assignment.
              </p>
            )}
          </div>
        </>
      )}
    </V4Drawer>
  );
}
