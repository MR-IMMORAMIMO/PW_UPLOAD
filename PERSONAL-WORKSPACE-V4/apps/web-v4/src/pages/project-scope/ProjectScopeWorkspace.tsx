import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import FinalScopeView from '../../components/final-ui/FinalScopeView';
import { ScopeRequirementsEditor } from './ScopeRequirementsEditor';
import { V4TextEditor } from '../../components/common/V4TextEditor';
import { generatePath, useNavigate, useParams } from 'react-router-dom';
import {
  SctMore as MoreHorizontal,
  SctWarning as ShieldAlert,
  SctGenerate as Sparkles,
  SctTag as Tag,
} from '../../components/common/SctIcons';
import { type LucideIcon } from 'lucide-react';
import { Flag, Info, Pencil, Plus, UserRound, Users, X } from '../../components/common/SctIcons';
import type {
  CreateProjectTagInput,
  CreateScopeNoteInput,
  ProjectRequirementInput,
  UpdateProjectScopeInput,
  UpdateProjectTagInput,
  UpdateScopeNoteInput,
} from '@scli/contracts';
import {
  projectTagColorKeys,
  projectServiceCodes,
  projectServiceLabels,
  type Project,
  type ProjectRequirement,
  type ProjectScopeItem,
  type ProjectTag,
  type ProjectWorkspace,
  type ScopeNote,
} from '@scli/domain';
import { api, apiRequest } from '../../api/environment';
import { formatBusinessDateOnly } from '../../date-time/businessDateTime';
import { V4Drawer } from '../../components/common/V4Drawer';
import { V4PageHeader } from '../../components/common/V4PageHeader';
import { V4RouteErrorState } from '../../components/common/V4RouteErrorState';
import { V4Pagination } from '../../components/common/V4Pagination';
import { V4RowTrailing } from '../../components/common/V4RowTrailing';
import { V4SectionTitle } from '../../components/common/V4SectionTitle';
import { v4SemanticIcons } from '../../components/common/V4SemanticIcons';
import { V4StatusPill } from '../../components/common/V4StatusPill';
import { V4ProjectContextHeader } from '../../components/project/V4ProjectContextHeader';
import { V4ProjectEditAction } from '../../components/project/V4ProjectEditAction';
import { V4AppShell } from '../../components/shell/V4AppShell';
import {
  readStoredSidebarMode,
  writeStoredSidebarMode,
  type SidebarMode,
} from '../../components/sidebar/sidebarMode';
import {
  ROUTE_PROJECT_SCOPE,
  ROUTE_PROJECT_DATASHEETS_IMAGES,
  ROUTE_PROJECT_TECHNICAL_CHECK,
  ROUTE_PROJECT_LUMINAIRE_SCHEDULE,
  ROUTE_PROJECT_TECHNICAL_BOQ,
  ROUTE_PROJECT_COMMENTS,
  ROUTE_PROJECT_SUMMARY,
  ROUTE_PROJECT_WORKFLOW_TIMELINE,
} from '../../router/routes';
import { deliverableStatusLabel, requirementSupportingText } from './projectScopeViewModel';

type ScopeWorkspace = ProjectWorkspace & { scopeItems: ProjectScopeItem[] };

const DENSE_ITEMS_PER_PAGE = 5;
const DEFAULT_ITEMS_PER_PAGE = 3;
function pageCountFor(totalItems: number, itemsPerPage = DEFAULT_ITEMS_PER_PAGE): number {
  return Math.max(1, Math.ceil(totalItems / itemsPerPage));
}

function effectivePageFor(currentPage: number, totalItems: number, itemsPerPage: number): number {
  return Math.min(Math.max(currentPage, 1), pageCountFor(totalItems, itemsPerPage));
}

function pageItems<T>(
  items: readonly T[],
  currentPage: number,
  itemsPerPage = DEFAULT_ITEMS_PER_PAGE,
) {
  const page = effectivePageFor(currentPage, items.length, itemsPerPage);
  return {
    page,
    pageCount: pageCountFor(items.length, itemsPerPage),
    items: items.slice((page - 1) * itemsPerPage, page * itemsPerPage),
  };
}

function requirementInput(item: ProjectRequirement): ProjectRequirementInput {
  return {
    category: item.category,
    title: item.title,
    details: item.details,
    requestedFrom: item.requestedFrom,
    requestedAt: item.requestedAt,
    dueDate: item.dueDate,
    status: item.status,
    impact: item.impact,
    sourceType: item.sourceType,
    sourceReference: item.sourceReference,
    notes: item.notes,
    sortOrder: item.sortOrder,
  };
}

function requirementStatusLabel(status: ProjectRequirement['status']): string {
  return status === 'NotRequired' ? 'Not Required' : status;
}

function scopeItemIcon(item: ProjectScopeItem): LucideIcon {
  if (item.code === 'LightingDesign' || /lighting design/i.test(item.label))
    return v4SemanticIcons.luminaireSelection;
  if (item.code === 'DialuxCalculation' || /calculation|dialux/i.test(item.label))
    return v4SemanticIcons.dialuxCalculation;
  if (item.code === 'LuminaireSchedule' || /schedule/i.test(item.label))
    return v4SemanticIcons.luminaireSchedule;
  if (item.code === 'TechnicalBoq' || /boq|quantity/i.test(item.label))
    return v4SemanticIcons.technicalBOQ;
  if (item.code === 'Datasheets' || /data.?sheet/i.test(item.label))
    return v4SemanticIcons.datasheet;
  if (/drawing|plan|review/i.test(item.label)) return v4SemanticIcons.lightingLayout;
  return v4SemanticIcons.projectScope;
}

function deliverableIcon(title: string): LucideIcon {
  if (/schedule/i.test(title)) return v4SemanticIcons.luminaireSchedule;
  if (/boq|quantity/i.test(title)) return v4SemanticIcons.technicalBOQ;
  if (/package|issue/i.test(title)) return v4SemanticIcons.package;
  if (/calculation|report/i.test(title)) return v4SemanticIcons.dialuxCalculation;
  return v4SemanticIcons.deliverables;
}

function CardPagination({
  currentPage,
  totalItems,
  itemsPerPage = DEFAULT_ITEMS_PER_PAGE,
  onChange,
}: {
  currentPage: number;
  totalItems: number;
  itemsPerPage?: number;
  onChange: (page: number) => void;
}) {
  const pageCount = pageCountFor(totalItems, itemsPerPage);
  if (pageCount < 2) return null;
  return (
    <V4Pagination
      pageCount={pageCount}
      currentPage={currentPage - 1}
      onChange={(page) => onChange(page + 1)}
      ariaLabel="Card pages"
    />
  );
}

function dateLabel(value: string | null): string | null {
  if (!value) return null;
  return formatBusinessDateOnly(value) || value;
}

function ScopeEditDrawer({
  project,
  scopeItems,
  onClose,
  onSave,
  saving,
  error,
}: {
  project: Project;
  scopeItems: ProjectScopeItem[];
  onClose: () => void;
  onSave: (input: UpdateProjectScopeInput) => void;
  saving: boolean;
  error: string | null;
}) {
  const [selectedCodes, setSelectedCodes] = useState(
    () => new Set(scopeItems.filter((item) => !item.custom && item.code).map((item) => item.code!)),
  );
  const [customItems, setCustomItems] = useState(() =>
    scopeItems.filter((item) => item.custom).map((item) => item.label),
  );
  const [customDraft, setCustomDraft] = useState('');
  const [discarding, setDiscarding] = useState(false);
  const initial = useMemo(
    () =>
      JSON.stringify(
        scopeItems.map((item) => ({ code: item.code, label: item.label, custom: item.custom })),
      ),
    [scopeItems],
  );
  const current = JSON.stringify([
    [...selectedCodes].sort(),
    customItems.map((item) => item.trim()).filter(Boolean),
  ]);
  const baseline = JSON.stringify([
    scopeItems
      .filter((item) => !item.custom && item.code)
      .map((item) => item.code)
      .sort(),
    scopeItems.filter((item) => item.custom).map((item) => item.label),
  ]);
  const dirty = current !== baseline || Boolean(customDraft.trim());
  void initial;

  const requestClose = () => {
    if (dirty && !discarding) {
      setDiscarding(true);
      return;
    }
    onClose();
  };
  const addCustom = () => {
    const value = customDraft.trim();
    if (!value || customItems.some((item) => item.toLowerCase() === value.toLowerCase())) return;
    setCustomItems((items) => [...items, value]);
    setCustomDraft('');
  };

  return (
    <V4Drawer
      presentation="float"
      open
      title={discarding ? 'Discard scope changes?' : 'Edit Scope'}
      description={
        discarding
          ? 'Your changes have not been saved.'
          : 'Choose the services and project-specific scope items that apply to this project.'
      }
      aria-label="Edit project scope"
      onClose={requestClose}
      footer={
        discarding ? (
          <div className="v4-scope-edit__footer">
            <button
              type="button"
              className="v4-scope-edit__secondary"
              onClick={() => setDiscarding(false)}
            >
              Keep editing
            </button>
            <button type="button" className="v4-scope-edit__discard" onClick={onClose}>
              Discard changes
            </button>
          </div>
        ) : (
          <div className="v4-scope-edit__footer">
            <button type="button" className="v4-scope-edit__secondary" onClick={requestClose}>
              Cancel
            </button>
            <button
              type="button"
              className="v4-scope-edit__save"
              disabled={saving || !dirty}
              onClick={() =>
                onSave({
                  expectedVersion: project.version,
                  scopeItems: [
                    ...[...selectedCodes].map((code) => ({ code, custom: false })),
                    ...customItems.map((label) => ({ label, custom: true })),
                  ],
                })
              }
            >
              Save scope
            </button>
          </div>
        )
      }
    >
      {discarding ? (
        <p className="v4-scope-edit__discard-copy">
          Discard the unsaved scope changes for this project?
        </p>
      ) : (
        <div className="v4-scope-edit">
          <section className="v4-scope-edit__section" aria-labelledby="v4-scope-services-title">
            <h3 id="v4-scope-services-title">Services</h3>
            <div className="v4-scope-edit__services">
              {projectServiceCodes.map((code) => (
                <label key={code} className="v4-scope-edit__check">
                  <input
                    type="checkbox"
                    checked={selectedCodes.has(code)}
                    onChange={() =>
                      setSelectedCodes((currentCodes) => {
                        const next = new Set(currentCodes);
                        if (next.has(code)) next.delete(code);
                        else next.add(code);
                        return next;
                      })
                    }
                  />
                  <span>{projectServiceLabels[code]}</span>
                </label>
              ))}
            </div>
          </section>
          <section className="v4-scope-edit__section" aria-labelledby="v4-scope-custom-title">
            <h3 id="v4-scope-custom-title">Project-specific scope</h3>
            {customItems.length ? (
              <ul className="v4-scope-edit__custom-list">
                {customItems.map((item) => (
                  <li key={item}>
                    <span>{item}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${item}`}
                      onClick={() =>
                        setCustomItems((items) => items.filter((candidate) => candidate !== item))
                      }
                    >
                      <X aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="v4-scope-edit__empty">No project-specific scope items.</p>
            )}
            <div className="v4-scope-edit__add">
              <label>
                <span className="v4-visually-hidden">Add project-specific scope item</span>
                <input
                  value={customDraft}
                  maxLength={200}
                  placeholder="Add a project-specific item"
                  onChange={(event) => setCustomDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addCustom();
                    }
                  }}
                />
              </label>
              <button type="button" onClick={addCustom} disabled={!customDraft.trim()}>
                <Plus aria-hidden="true" /> Add
              </button>
            </div>
          </section>
          {error ? (
            <p className="v4-scope-edit__error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </V4Drawer>
  );
}

function AddRequirementDrawer({
  onClose,
  onSave,
  saving,
  error,
  sortOrder,
  initial,
}: {
  onClose: () => void;
  onSave: (input: ProjectRequirementInput) => void;
  saving: boolean;
  error: string | null;
  sortOrder: number;
  initial?: ProjectRequirement;
}) {
  const [category, setCategory] = useState(initial?.category ?? 'Project information');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [details, setDetails] = useState(initial?.details ?? '');
  const [requestedFrom, setRequestedFrom] = useState(initial?.requestedFrom ?? '');
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!category.trim() || !title.trim()) return;
    onSave({
      category: category.trim(),
      title: title.trim(),
      details: details.trim(),
      requestedFrom: requestedFrom.trim(),
      requestedAt: initial?.requestedAt ?? null,
      dueDate: initial?.dueDate ?? null,
      status: initial?.status ?? 'Missing',
      impact: initial?.impact ?? 'Medium',
      sourceType: initial?.sourceType ?? 'Manual',
      sourceReference: initial?.sourceReference ?? '',
      notes: initial?.notes ?? '',
      sortOrder,
    });
  };

  return (
    <V4Drawer
      presentation="float"
      open
      title={initial ? 'Edit requirement' : 'Add requirement'}
      description="Record optional requirements. Include units such as lx, K, or hours in the details where applicable."
      aria-label={initial ? 'Edit project requirement' : 'Add project requirement'}
      onClose={onClose}
    >
      <form className="v4-scope-edit" onSubmit={submit}>
        <label className="v4-scope-edit__field">
          Category
          <input
            value={category}
            maxLength={120}
            onChange={(event) => setCategory(event.target.value)}
          />
        </label>
        <label className="v4-scope-edit__field">
          Requirement
          <input
            value={title}
            maxLength={300}
            required
            placeholder="e.g. Coordinated reflected ceiling plan"
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="v4-scope-edit__field">
          Details <span>Optional</span>
          <textarea
            value={details}
            maxLength={8000}
            onChange={(event) => setDetails(event.target.value)}
          />
        </label>
        <label className="v4-scope-edit__field">
          Requested from <span>Optional</span>
          <input
            value={requestedFrom}
            maxLength={300}
            onChange={(event) => setRequestedFrom(event.target.value)}
          />
        </label>
        {error ? (
          <p className="v4-scope-edit__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="v4-scope-edit__footer">
          <button type="button" className="v4-scope-edit__secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="v4-scope-edit__save"
            disabled={saving || !category.trim() || !title.trim()}
          >
            {initial ? 'Save requirement' : 'Add requirement'}
          </button>
        </div>
      </form>
    </V4Drawer>
  );
}

function TagDrawer({
  tag,
  onClose,
  onSave,
  onDelete,
  saving,
  error,
}: {
  tag: ProjectTag | null;
  onClose: () => void;
  onSave: (input: CreateProjectTagInput | UpdateProjectTagInput) => void;
  onDelete: (tag: ProjectTag) => void;
  saving: boolean;
  error: string | null;
}) {
  const [label, setLabel] = useState(tag?.label ?? '');
  const [colorKey, setColorKey] = useState<ProjectTag['colorKey']>(tag?.colorKey ?? 'teal');
  const isEdit = Boolean(tag);
  return (
    <V4Drawer
      presentation="float"
      open
      title={isEdit ? 'Change tag color' : 'Add tag'}
      description={
        isEdit
          ? 'Update the tag color. Its label and identity are retained.'
          : 'Add a concise project tag.'
      }
      aria-label={isEdit ? 'Change tag color' : 'Add tag'}
      onClose={onClose}
      footer={
        <div className="v4-scope-edit__footer">
          <button type="button" className="v4-scope-edit__secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="v4-scope-edit__save"
            disabled={saving || (!isEdit && !label.trim())}
            onClick={() => onSave(isEdit ? { colorKey } : { label: label.trim(), colorKey })}
          >
            {isEdit ? 'Save color' : 'Add tag'}
          </button>
          {tag ? (
            <button type="button" className="v4-scope-edit__discard" onClick={() => onDelete(tag)}>
              Delete tag
            </button>
          ) : null}
        </div>
      }
    >
      <div className="v4-scope-edit">
        {!isEdit ? (
          <label className="v4-scope-edit__field">
            Tag name
            <input
              value={label}
              maxLength={80}
              onChange={(event) => setLabel(event.target.value)}
            />
          </label>
        ) : null}
        <fieldset className="v4-scope-edit__palette">
          <legend>Color</legend>
          <div>
            {projectTagColorKeys.map((key) => (
              <button
                key={key}
                type="button"
                className={`v4-scope-edit__swatch v4-scope-edit__swatch--${key}`}
                aria-label={`Use ${key} tag color`}
                aria-pressed={colorKey === key}
                onClick={() => setColorKey(key)}
              />
            ))}
          </div>
        </fieldset>
        {error ? (
          <p className="v4-scope-edit__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </V4Drawer>
  );
}

function ScopeNoteDrawer({
  note,
  sortOrder,
  onClose,
  onSave,
  onDelete,
  saving,
  error,
}: {
  note: ScopeNote | null;
  sortOrder: number;
  onClose: () => void;
  onSave: (input: CreateScopeNoteInput | UpdateScopeNoteInput) => void;
  onDelete: (note: ScopeNote) => void;
  saving: boolean;
  error: string | null;
}) {
  const [type, setType] = useState<ScopeNote['type']>(note?.type ?? 'Note');
  const [text, setText] = useState(note?.text ?? '');
  const [discarding, setDiscarding] = useState(false);
  const baseline = `${note?.type ?? 'Note'}\u0000${note?.text ?? ''}`;
  const dirty = `${type}\u0000${text}` !== baseline;
  const requestClose = () => {
    if (dirty && !discarding) {
      setDiscarding(true);
      return;
    }
    onClose();
  };
  return (
    <V4Drawer
      presentation="float"
      open
      title={
        discarding
          ? 'Discard note changes?'
          : note
            ? 'Edit note or exclusion'
            : 'Add note or exclusion'
      }
      description={
        discarding
          ? 'Your changes have not been saved.'
          : 'Keep scope-specific decisions clear and concise.'
      }
      aria-label="Scope note editor"
      onClose={requestClose}
      footer={
        discarding ? (
          <div className="v4-scope-edit__footer">
            <button
              type="button"
              className="v4-scope-edit__secondary"
              onClick={() => setDiscarding(false)}
            >
              Keep editing
            </button>
            <button type="button" className="v4-scope-edit__discard" onClick={onClose}>
              Discard changes
            </button>
          </div>
        ) : (
          <div className="v4-scope-edit__footer">
            <button type="button" className="v4-scope-edit__secondary" onClick={requestClose}>
              Cancel
            </button>
            <button
              type="button"
              className="v4-scope-edit__save"
              disabled={saving || !text.trim() || !dirty}
              onClick={() =>
                onSave({ type, text: text.trim(), sortOrder: note?.sortOrder ?? sortOrder })
              }
            >
              {note ? 'Save changes' : 'Add record'}
            </button>
            {note ? (
              <button
                type="button"
                className="v4-scope-edit__discard"
                onClick={() => onDelete(note)}
              >
                Delete {note.type.toLowerCase()}
              </button>
            ) : null}
          </div>
        )
      }
    >
      {discarding ? (
        <p className="v4-scope-edit__discard-copy">
          Discard the unsaved note or exclusion changes?
        </p>
      ) : (
        <div className="v4-scope-edit">
          <label className="v4-scope-edit__field">
            Type
            <select
              value={type}
              onChange={(event) => setType(event.target.value as ScopeNote['type'])}
            >
              <option value="Note">Note</option>
              <option value="Exclusion">Exclusion</option>
            </select>
          </label>
          <label className="v4-scope-edit__field">
            Text
            <textarea
              value={text}
              maxLength={1000}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          {error ? (
            <p className="v4-scope-edit__error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </V4Drawer>
  );
}

export function ProjectScopeWorkspace({ finalView = false }: { finalView?: boolean } = {}) {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<SidebarMode>(() => readStoredSidebarMode(window.localStorage));
  const [editing, setEditing] = useState(false);
  const [editingCriteria, setEditingCriteria] = useState(false);
  const [editingSetupNotes, setEditingSetupNotes] = useState(false);
  const scopeAudit = useQuery({
    queryKey: ['v4', 'scope', 'audit', projectId],
    queryFn: () => api.activities(projectId!),
    enabled: !!projectId,
  });
  const [addingRequirement, setAddingRequirement] = useState(false);
  const [editingRequirement, setEditingRequirement] = useState<ProjectRequirement | null>(null);
  const [requirementActionTarget, setRequirementActionTarget] = useState<ProjectRequirement | null>(
    null,
  );
  const [requirementDeleteTarget, setRequirementDeleteTarget] = useState<ProjectRequirement | null>(
    null,
  );
  const [tagEditor, setTagEditor] = useState<ProjectTag | 'new' | null>(null);
  const [noteEditor, setNoteEditor] = useState<ScopeNote | 'new' | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<
    { kind: 'tag'; item: ProjectTag } | { kind: 'note'; item: ScopeNote } | null
  >(null);
  const [scopePage, setScopePage] = useState(1);
  const [deliverablesPage, setDeliverablesPage] = useState(1);
  const [requirementsPage, setRequirementsPage] = useState(1);
  const [scopeNotesPage, setScopeNotesPage] = useState(1);
  const requirementUpdateInFlightRef = useRef(false);
  const requirementDeleteInFlightRef = useRef(false);
  const projectQuery = useQuery({
    queryKey: ['v4', 'scope', 'project', projectId],
    queryFn: () => api.project(projectId as string),
    enabled: Boolean(projectId),
  });
  const workspaceQuery = useQuery({
    queryKey: ['v4', 'scope', 'workspace', projectId],
    queryFn: () => apiRequest<ScopeWorkspace>(`/api/projects/${projectId}/workspace`),
    enabled: Boolean(projectId),
  });
  const saveScope = useMutation({
    mutationFn: (input: UpdateProjectScopeInput) =>
      apiRequest<{ workspace: ScopeWorkspace }>(`/api/projects/${projectId}/scope`, {
        method: 'PATCH',
        body: input,
      }),
    onSuccess: (result) => {
      queryClient.setQueryData(['v4', 'scope', 'workspace', projectId], result.workspace);
      void queryClient.invalidateQueries({ queryKey: ['v4', 'scope', 'project', projectId] });
      setEditing(false);
    },
  });
  const addRequirement = useMutation({
    mutationFn: (input: ProjectRequirementInput) =>
      apiRequest(`/api/projects/${projectId}/requirements`, { method: 'POST', body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['v4', 'scope', 'workspace', projectId] });
      setAddingRequirement(false);
    },
  });
  const saveRequirement = useMutation({
    mutationFn: ({ item, input }: { item: ProjectRequirement; input: ProjectRequirementInput }) =>
      apiRequest(`/api/projects/${projectId}/requirements/${item.id}`, {
        method: 'PATCH',
        body: input,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['v4', 'scope', 'workspace', projectId] });
      setEditingRequirement(null);
    },
  });
  const markRequirementNotRequired = useMutation({
    mutationFn: (item: ProjectRequirement) =>
      apiRequest<ProjectRequirement>(`/api/projects/${projectId}/requirements/${item.id}`, {
        method: 'PATCH',
        body: { ...requirementInput(item), status: 'NotRequired' },
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData<ScopeWorkspace>(
        ['v4', 'scope', 'workspace', projectId],
        (current) =>
          current
            ? {
                ...current,
                requirements: current.requirements.map((item) =>
                  item.id === updated.id ? updated : item,
                ),
              }
            : current,
      );
      setRequirementActionTarget(null);
    },
    onSettled: () => {
      requirementUpdateInFlightRef.current = false;
    },
  });
  const deleteRequirement = useMutation({
    mutationFn: (item: ProjectRequirement) =>
      apiRequest<{ deleted: boolean }>(`/api/projects/${projectId}/requirements/${item.id}`, {
        method: 'DELETE',
      }),
    onSuccess: (_result, item) => {
      queryClient.setQueryData<ScopeWorkspace>(
        ['v4', 'scope', 'workspace', projectId],
        (current) =>
          current
            ? {
                ...current,
                requirements: current.requirements.filter(
                  (requirement) => requirement.id !== item.id,
                ),
              }
            : current,
      );
      setRequirementDeleteTarget(null);
    },
    onSettled: () => {
      requirementDeleteInFlightRef.current = false;
    },
  });
  const submitMarkRequirementNotRequired = (item: ProjectRequirement) => {
    if (requirementUpdateInFlightRef.current) return;
    requirementUpdateInFlightRef.current = true;
    markRequirementNotRequired.mutate(item);
  };
  const submitDeleteRequirement = (item: ProjectRequirement) => {
    if (requirementDeleteInFlightRef.current) return;
    requirementDeleteInFlightRef.current = true;
    deleteRequirement.mutate(item);
  };
  const saveTag = useMutation({
    mutationFn: ({
      tag,
      input,
    }: {
      tag: ProjectTag | 'new';
      input: CreateProjectTagInput | UpdateProjectTagInput;
    }) =>
      apiRequest(`/api/projects/${projectId}/tags${tag === 'new' ? '' : `/${tag.id}`}`, {
        method: tag === 'new' ? 'POST' : 'PATCH',
        body: input,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['v4', 'scope', 'workspace', projectId] });
      setTagEditor(null);
    },
  });
  const deleteTag = useMutation({
    mutationFn: (tag: ProjectTag) =>
      apiRequest(`/api/projects/${projectId}/tags/${tag.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['v4', 'scope', 'workspace', projectId] });
      setDeleteTarget(null);
    },
  });
  const saveScopeNote = useMutation({
    mutationFn: ({
      note,
      input,
    }: {
      note: ScopeNote | 'new';
      input: CreateScopeNoteInput | UpdateScopeNoteInput;
    }) =>
      apiRequest(`/api/projects/${projectId}/scope-notes${note === 'new' ? '' : `/${note.id}`}`, {
        method: note === 'new' ? 'POST' : 'PATCH',
        body: input,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['v4', 'scope', 'workspace', projectId] });
      setNoteEditor(null);
    },
  });
  const deleteScopeNote = useMutation({
    mutationFn: (note: ScopeNote) =>
      apiRequest(`/api/projects/${projectId}/scope-notes/${note.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['v4', 'scope', 'workspace', projectId] });
      setDeleteTarget(null);
    },
  });
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [projectId]);
  const workspace = workspaceQuery.data;
  const loading = projectQuery.isLoading || workspaceQuery.isLoading;
  const error = projectQuery.isError || workspaceQuery.isError;
  const retrying = projectQuery.isFetching || workspaceQuery.isFetching;
  const toggleSidebar = () =>
    setMode((current) => {
      const next: SidebarMode = current === 'extended' ? 'minimal' : 'extended';
      writeStoredSidebarMode(window.localStorage, next);
      return next;
    });
  const onSelectSection = (id: string) => {
    if (!projectId) return;
    const routes: Record<string, string> = {
      summary: ROUTE_PROJECT_SUMMARY,
      workflow: ROUTE_PROJECT_WORKFLOW_TIMELINE,
      scope: ROUTE_PROJECT_SCOPE,
      comments: ROUTE_PROJECT_COMMENTS,
      datasheets: ROUTE_PROJECT_DATASHEETS_IMAGES,
      'technical-check': ROUTE_PROJECT_TECHNICAL_CHECK,
      'lighting-schedule': ROUTE_PROJECT_LUMINAIRE_SCHEDULE,
      'technical-boq': ROUTE_PROJECT_TECHNICAL_BOQ,
    };
    if (routes[id]) navigate(generatePath(routes[id], { projectId }));
  };
  const scopeItems = pageItems(workspace?.scopeItems ?? [], scopePage, DENSE_ITEMS_PER_PAGE);
  const deliverables = pageItems(
    workspace?.deliverables ?? [],
    deliverablesPage,
    DENSE_ITEMS_PER_PAGE,
  );
  const requirements = pageItems(workspace?.requirements ?? [], requirementsPage);
  const scopeNotes = pageItems(workspace?.scopeNotes ?? [], scopeNotesPage);

  // Render from the clamped page immediately, then retain that valid page in
  // state. This prevents a shrinking collection or project change from ever
  // briefly rendering an empty, unreachable card.
  useEffect(() => {
    setScopePage(scopeItems.page);
    setDeliverablesPage(deliverables.page);
    setRequirementsPage(requirements.page);
    setScopeNotesPage(scopeNotes.page);
  }, [scopeItems.page, deliverables.page, requirements.page, scopeNotes.page, projectId]);

  return (
    <V4AppShell
      context="project"
      sidebarMode={mode}
      onToggleSidebarMode={toggleSidebar}
      activeSectionId="scope"
      onSelectSection={onSelectSection}
      project={
        projectQuery.data
          ? {
              projectCode: projectQuery.data.projectCode,
              projectName: projectQuery.data.projectName,
              status: projectQuery.data.status ?? null,
            }
          : null
      }
      projectLoading={loading}
      projectContextHeader={
        <V4ProjectContextHeader
          data={{
            projectCode: projectQuery.data?.projectCode ?? '',
            projectName: projectQuery.data?.projectName ?? '',
            clientName: projectQuery.data?.clientName ?? null,
            projectType: projectQuery.data?.projectType ?? null,
            designStage: projectQuery.data?.designStage ?? null,
            requiredDeliveryDate: projectQuery.data?.requiredDeliveryDate ?? null,
          }}
          actions={
            <V4ProjectEditAction
              project={projectQuery.data}
              projectQueryKey={['v4', 'scope', 'project', projectId]}
            />
          }
        />
      }
      pageHeader={
        <div className="v4-scope-page-header" hidden={finalView}>
          <V4PageHeader
            icon={v4SemanticIcons.projectScope}
            title="Scope & Services"
            description="Review the active project scope, required deliverables, and information needed to move the work forward."
            actions={
              <button
                type="button"
                className="v4-scope__edit-action"
                disabled={!projectQuery.data || !workspace || saveScope.isPending}
                onClick={() => setEditing(true)}
              >
                <Pencil aria-hidden="true" /> Edit Scope
              </button>
            }
          />
        </div>
      }
      boundedPage
    >
      <div
        className={finalView ? 'v4-bounded-page' : 'v4-scope v4-bounded-page'}
        style={finalView ? { display: 'flex', flex: 1, minHeight: 0 } : undefined}
        data-testid="v4-project-scope"
      >
        {loading ? <ScopeSkeleton /> : null}
        {!loading && error ? (
          <V4RouteErrorState
            title="Unable to load project scope"
            message="Scope, services, and requirement data could not be loaded."
            retrying={retrying}
            onRetry={() => void Promise.all([projectQuery.refetch(), workspaceQuery.refetch()])}
          />
        ) : null}
        {!loading && workspace && projectQuery.data ? (
          finalView ? (
            <FinalScopeView
              binding={{
                project: projectQuery.data,
                workspace,
                edit: () => setEditing(true),
                addTag: () => setTagEditor('new'),
                editTag: setTagEditor,
                editNote: setNoteEditor,
                editSetupNotes: () => setEditingSetupNotes(true),
                addNote: () => setNoteEditor('new'),
                addRequirement: () => setAddingRequirement(true),
                editRequirements: () => setEditingCriteria(true),
                editRequirement: setEditingRequirement,
                pending: saveScope.isPending,
                audit: Array.isArray(scopeAudit.data) ? scopeAudit.data : [],
              }}
            />
          ) : (
            <div className="v4-scope__layout">
              <div className="v4-scope__primary">
                <section
                  className="v4-scope-card v4-scope-card--scope"
                  aria-labelledby="v4-scope-title"
                >
                  <V4SectionTitle
                    className="v4-scope-card__header"
                    icon={v4SemanticIcons.projectScope}
                    title="Project Scope"
                    description="Active services and project-specific work items."
                    tone="scope"
                    headingId="v4-scope-title"
                  />
                  {workspace.scopeItems.length ? (
                    <ul className="v4-scope__scope-list">
                      {scopeItems.items.map((item) => {
                        const Icon = scopeItemIcon(item);
                        return (
                          <li key={item.id}>
                            <span className="v4-scope__item-icon v4-scope__item-icon--teal">
                              <Icon aria-hidden />
                            </span>
                            <span>{item.label}</span>
                            <V4StatusPill variant="success">
                              {item.custom ? 'Project-specific' : 'Included'}
                            </V4StatusPill>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="v4-scope__empty">No active scope items are recorded.</p>
                  )}
                  <CardPagination
                    currentPage={scopeItems.page}
                    totalItems={workspace.scopeItems.length}
                    itemsPerPage={DENSE_ITEMS_PER_PAGE}
                    onChange={setScopePage}
                  />
                </section>
                <section className="v4-scope-card" aria-labelledby="v4-deliverables-title">
                  <V4SectionTitle
                    className="v4-scope-card__header"
                    icon={v4SemanticIcons.deliverables}
                    title="Deliverables"
                    description="Canonical deliverables generated for the current project scope."
                    tone="deliverables"
                    headingId="v4-deliverables-title"
                  />
                  {workspace.deliverables.length ? (
                    <ul className="v4-scope__deliverable-list">
                      {deliverables.items.map((item) => {
                        const Icon = deliverableIcon(item.title);
                        return (
                          <li key={item.id}>
                            <span className="v4-scope__item-icon v4-scope__item-icon--blue">
                              <Icon aria-hidden />
                            </span>
                            <div>
                              <strong>{item.title}</strong>
                              <span>
                                {item.required ? 'Required deliverable' : 'Optional deliverable'}
                                {item.dueDate ? ` · Due ${dateLabel(item.dueDate)}` : ''}
                                {` · Status · ${deliverableStatusLabel(item)}`}
                              </span>
                            </div>
                            <V4RowTrailing>
                              <V4StatusPill variant="success">Included</V4StatusPill>
                            </V4RowTrailing>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="v4-scope__empty">No deliverables are recorded for this scope.</p>
                  )}
                  <CardPagination
                    currentPage={deliverables.page}
                    totalItems={workspace.deliverables.length}
                    itemsPerPage={DENSE_ITEMS_PER_PAGE}
                    onChange={setDeliverablesPage}
                  />
                </section>
                <section className="v4-scope-card" aria-labelledby="v4-requirements-title">
                  <V4SectionTitle
                    className="v4-scope-card__header"
                    icon={v4SemanticIcons.requirements}
                    title="Requirements"
                    description="Information tracked against the project workspace."
                    tone="requirements"
                    headingId="v4-requirements-title"
                    action={
                      <button
                        type="button"
                        className="v4-scope__add-icon"
                        aria-label="Add requirement"
                        onClick={() => setAddingRequirement(true)}
                      >
                        <Plus aria-hidden="true" />
                      </button>
                    }
                  />
                  {workspace.requirements.length ? (
                    <ul className="v4-scope__requirement-list">
                      {requirements.items.map((item) => (
                        <li key={item.id}>
                          <ShieldAlert aria-hidden="true" />
                          <div>
                            <strong>{item.title}</strong>
                            {requirementSupportingText(item) ? (
                              <span>{requirementSupportingText(item)}</span>
                            ) : null}
                          </div>
                          <V4RowTrailing>
                            <V4StatusPill
                              variant={
                                item.status === 'Missing'
                                  ? 'danger'
                                  : item.status === 'NotRequired'
                                    ? 'neutral'
                                    : 'warning'
                              }
                            >
                              {requirementStatusLabel(item.status)}
                            </V4StatusPill>
                            <div className="v4-scope__requirement-actions">
                              <button
                                type="button"
                                className="v4-scope__requirement-action-trigger"
                                aria-label={`Requirement actions: ${item.title}`}
                                aria-expanded={requirementActionTarget?.id === item.id}
                                onClick={() =>
                                  setRequirementActionTarget((current) =>
                                    current?.id === item.id ? null : item,
                                  )
                                }
                              >
                                <MoreHorizontal aria-hidden="true" />
                              </button>
                              {requirementActionTarget?.id === item.id ? (
                                <div className="v4-scope__requirement-action-menu" role="menu">
                                  {item.status !== 'NotRequired' ? (
                                    <button
                                      type="button"
                                      role="menuitem"
                                      disabled={markRequirementNotRequired.isPending}
                                      onClick={() => submitMarkRequirementNotRequired(item)}
                                    >
                                      Mark as Not Required
                                    </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    role="menuitem"
                                    disabled={markRequirementNotRequired.isPending}
                                    onClick={() => {
                                      setRequirementActionTarget(null);
                                      setRequirementDeleteTarget(item);
                                    }}
                                  >
                                    Delete Permanently
                                  </button>
                                  {markRequirementNotRequired.error instanceof Error ? (
                                    <p className="v4-scope__requirement-action-error" role="alert">
                                      {markRequirementNotRequired.error.message}
                                    </p>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          </V4RowTrailing>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="v4-scope__empty">No project requirements are recorded.</p>
                  )}
                  <CardPagination
                    currentPage={requirements.page}
                    totalItems={workspace.requirements.length}
                    onChange={setRequirementsPage}
                  />
                </section>
                <section
                  className="v4-scope-card v4-scope-card--notes"
                  aria-labelledby="v4-notes-exclusions-title"
                >
                  <V4SectionTitle
                    className="v4-scope-card__header"
                    icon={v4SemanticIcons.note}
                    title="Notes & Exclusions"
                    description="Canonical project-scope decisions and boundaries."
                    tone="notes"
                    headingId="v4-notes-exclusions-title"
                    action={
                      <button
                        type="button"
                        className="v4-scope__add-icon"
                        aria-label="Add note or exclusion"
                        onClick={() => setNoteEditor('new')}
                      >
                        <Plus aria-hidden="true" />
                      </button>
                    }
                  />
                  {workspace.scopeNotes.length ? (
                    <ul className="v4-scope__notes-list">
                      {scopeNotes.items.map((note) => (
                        <li key={note.id}>
                          <button
                            type="button"
                            className="v4-scope__note-action"
                            aria-label={`Edit ${note.type.toLowerCase()}: ${note.text}`}
                            onClick={() => setNoteEditor(note)}
                          >
                            <strong>{note.type === 'Note' ? 'NOTE' : 'EXCLUSION'}</strong>
                            <span>{note.text}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="v4-scope__notes-empty">No notes or exclusions are recorded.</p>
                  )}
                  <CardPagination
                    currentPage={scopeNotes.page}
                    totalItems={workspace.scopeNotes.length}
                    onChange={setScopeNotesPage}
                  />
                </section>
              </div>
              <aside className="v4-scope__summary" aria-label="Scope summary">
                <section className="v4-scope-summary-card">
                  <header className="v4-scope-summary-card__header">
                    <span className="v4-scope-card__icon v4-scope-card__icon--teal">
                      <Sparkles aria-hidden="true" />
                    </span>
                    <h2>Scope Summary</h2>
                  </header>
                  <dl>
                    <div>
                      <dt>
                        <Users aria-hidden="true" />
                        <span>Client</span>
                      </dt>
                      <dd>{projectQuery.data.clientName || '—'}</dd>
                    </div>
                    <div>
                      <dt>
                        <UserRound aria-hidden="true" />
                        <span>Sales</span>
                      </dt>
                      <dd>{projectQuery.data.salesOwnerNameSnapshot || '—'}</dd>
                    </div>
                    <div>
                      <dt>
                        <Flag aria-hidden="true" />
                        <span>Priority</span>
                      </dt>
                      <dd>
                        <span
                          className={`v4-scope__priority v4-scope__priority--${projectQuery.data.priority?.toLowerCase() ?? 'unknown'}`}
                        >
                          {projectQuery.data.priority ?? '—'}
                        </span>
                      </dd>
                    </div>
                  </dl>
                  <dl className="v4-scope-summary-card__tags">
                    <div>
                      <dt>
                        <Tag aria-hidden="true" />
                        <span>Tags</span>
                      </dt>
                      <dd>
                        <ul>
                          {workspace.tags.map((tag) => (
                            <li key={tag.id}>
                              <button
                                type="button"
                                className={`v4-scope__tag v4-scope__tag--${tag.colorKey}`}
                                aria-label={`Manage ${tag.label}`}
                                onClick={() => setTagEditor(tag)}
                              >
                                {tag.label}
                              </button>
                            </li>
                          ))}
                          <li>
                            <button
                              type="button"
                              className="v4-scope__tag-add"
                              aria-label="Add tag"
                              onClick={() => setTagEditor('new')}
                            >
                              <Plus aria-hidden="true" />
                            </button>
                          </li>
                        </ul>
                      </dd>
                    </div>
                  </dl>
                  <div className="v4-scope-summary-card__key-info">
                    <h3>
                      <Info aria-hidden="true" /> Key Info
                    </h3>
                    <p>
                      Scope and services establish the boundaries of work and expected deliverables.
                      Changes to scope may affect programme, coordination, or delivery expectations.
                    </p>
                  </div>
                </section>
              </aside>
            </div>
          )
        ) : null}
      </div>
      {editingSetupNotes && projectQuery.data && workspace && (
        <V4TextEditor
          title="Edit Scope Notes"
          value={projectQuery.data.finalSetup?.notes ?? ''}
          onClose={() => setEditingSetupNotes(false)}
          onSave={async (scopeNotes) => {
            await api.updateProjectConfiguration(projectId!, {
              scopeNotes,
              expectedVersion: projectQuery.data!.version,
              scopeItems: workspace.scopeItems.map(({ code, label, custom }) => ({
                code,
                label,
                custom,
              })),
              luminaireInputMode: projectQuery.data!.luminaireInputMode ?? 'Later',
            });
            await queryClient.invalidateQueries({ queryKey: ['v4', 'scope'] });
          }}
        />
      )}
      {editingCriteria && projectQuery.data && workspace && (
        <ScopeRequirementsEditor
          project={projectQuery.data}
          workspace={workspace}
          onClose={() => setEditingCriteria(false)}
        />
      )}
      {editing && projectQuery.data && workspace ? (
        <ScopeEditDrawer
          project={projectQuery.data}
          scopeItems={workspace.scopeItems}
          saving={saveScope.isPending}
          error={saveScope.error instanceof Error ? saveScope.error.message : null}
          onClose={() => setEditing(false)}
          onSave={(input) => saveScope.mutate(input)}
        />
      ) : null}
      {editingRequirement ? (
        <AddRequirementDrawer
          key={editingRequirement.id}
          initial={editingRequirement}
          sortOrder={editingRequirement.sortOrder}
          saving={saveRequirement.isPending}
          error={saveRequirement.error instanceof Error ? saveRequirement.error.message : null}
          onClose={() => setEditingRequirement(null)}
          onSave={(input) => saveRequirement.mutate({ item: editingRequirement, input })}
        />
      ) : null}
      {addingRequirement && workspace ? (
        <AddRequirementDrawer
          sortOrder={workspace.requirements.length}
          saving={addRequirement.isPending}
          error={addRequirement.error instanceof Error ? addRequirement.error.message : null}
          onClose={() => setAddingRequirement(false)}
          onSave={(input) => addRequirement.mutate(input)}
        />
      ) : null}
      {requirementDeleteTarget ? (
        <V4Drawer
          presentation="float"
          open
          title="Delete requirement?"
          description="This requirement will be permanently removed from the project."
          aria-label="Confirm permanent requirement deletion"
          onClose={() => setRequirementDeleteTarget(null)}
          footer={
            <div className="v4-scope-edit__footer">
              <button
                type="button"
                className="v4-scope-edit__secondary"
                onClick={() => setRequirementDeleteTarget(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="v4-scope-edit__discard"
                disabled={deleteRequirement.isPending}
                onClick={() => submitDeleteRequirement(requirementDeleteTarget)}
              >
                Delete Permanently
              </button>
            </div>
          }
        >
          <p className="v4-scope-edit__discard-copy">{requirementDeleteTarget.title}</p>
          {deleteRequirement.error instanceof Error ? (
            <p className="v4-scope-edit__error" role="alert">
              {deleteRequirement.error.message}
            </p>
          ) : null}
        </V4Drawer>
      ) : null}
      {tagEditor ? (
        <TagDrawer
          tag={tagEditor === 'new' ? null : tagEditor}
          saving={saveTag.isPending}
          error={saveTag.error instanceof Error ? saveTag.error.message : null}
          onClose={() => setTagEditor(null)}
          onSave={(input) => saveTag.mutate({ tag: tagEditor, input })}
          onDelete={(tag) => {
            setTagEditor(null);
            setDeleteTarget({ kind: 'tag', item: tag });
          }}
        />
      ) : null}
      {noteEditor && workspace ? (
        <ScopeNoteDrawer
          note={noteEditor === 'new' ? null : noteEditor}
          sortOrder={workspace.scopeNotes.length}
          saving={saveScopeNote.isPending}
          error={saveScopeNote.error instanceof Error ? saveScopeNote.error.message : null}
          onClose={() => setNoteEditor(null)}
          onSave={(input) => saveScopeNote.mutate({ note: noteEditor, input })}
          onDelete={(note) => {
            setNoteEditor(null);
            setDeleteTarget({ kind: 'note', item: note });
          }}
        />
      ) : null}
      {deleteTarget ? (
        <V4Drawer
          presentation="float"
          open
          title={deleteTarget.kind === 'tag' ? 'Delete tag?' : 'Delete note or exclusion?'}
          description="This permanent action cannot be undone."
          aria-label="Confirm permanent deletion"
          onClose={() => setDeleteTarget(null)}
          footer={
            <div className="v4-scope-edit__footer">
              <button
                type="button"
                className="v4-scope-edit__secondary"
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="v4-scope-edit__discard"
                disabled={deleteTag.isPending || deleteScopeNote.isPending}
                onClick={() =>
                  deleteTarget.kind === 'tag'
                    ? deleteTag.mutate(deleteTarget.item)
                    : deleteScopeNote.mutate(deleteTarget.item)
                }
              >
                Delete permanently
              </button>
            </div>
          }
        >
          <p className="v4-scope-edit__discard-copy">
            {deleteTarget.kind === 'tag' ? deleteTarget.item.label : deleteTarget.item.text}
          </p>
          {(deleteTag.error || deleteScopeNote.error) instanceof Error ? (
            <p className="v4-scope-edit__error" role="alert">
              {((deleteTag.error || deleteScopeNote.error) as Error).message}
            </p>
          ) : null}
        </V4Drawer>
      ) : null}
    </V4AppShell>
  );
}

function ScopeSkeleton() {
  return (
    <div className="v4-scope__skeleton" data-testid="v4-scope-skeleton" aria-busy="true">
      <div />
      <div />
      <div />
    </div>
  );
}
