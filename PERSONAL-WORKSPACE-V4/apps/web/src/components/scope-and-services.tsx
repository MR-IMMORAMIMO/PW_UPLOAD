import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Check,
  Layers,
  List,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  normalizeScopeLabel,
  projectServiceCodes,
  projectServiceLabels,
  type Project,
  type ProjectDeliverable,
  type ProjectRequirement,
  type ProjectScopeItem,
  type ProjectServiceCode,
} from '@scli/domain';
import { api, apiRequest, ApiError } from '../api';
import { formatCommercialValue } from '../commercial-value';
import { useToast } from '../components/toast';
import { EmptyState } from '../components/ui';
import { projectContextHeader } from '../project-summary-model';
import { ProjectContextHeaderView } from '../components/project-summary';
import type { ProjectWorkspace } from '@scli/domain';
import { scopeServicesView } from '../scope-services-model';

/**
 * Bounded preview capacities for the Scope & Services overview composition. These are
 * presentation-only: the full canonical collections are always available (see the
 * `Show all (N)` collection drawer). They are NOT a global design-system constant — they
 * belong to this approved Scope visual composition.
 */
const SCOPE_SERVICES_PREVIEW = 5;
const DELIVERABLES_PREVIEW = 5;
const REQUIREMENTS_PREVIEW = 4;
const EXCLUSIONS_PREVIEW = 4;

/** The collection shown in the full-list right-side drawer. */
type CollectionKind = 'services' | 'deliverables' | 'requirements' | 'exclusions' | 'fullScope';

/**
 * Deterministic narrative preview helper for the Project Scope card.
 *
 * A long canonical `lightingScope` / `luxRequirements` value can otherwise grow the
 * overview card beyond the bounded grammar. We use a conservative content-length
 * threshold to decide when a field is "long enough" to warrant a clamped preview +
 * `View full scope`. This is presentation-only: the full canonical text is never
 * truncated in persistence and is always available in the Full Scope drawer.
 *
 * We deliberately avoid fragile runtime DOM-overflow measurement (which is brittle
 * under test and resize); a deterministic threshold plus CSS line-clamp keeps the
 * behavior testable and consistent.
 */
const NARRATIVE_LONG_THRESHOLD = 180;

function isNarrativeLong(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.length > NARRATIVE_LONG_THRESHOLD;
}

/**
 * Project workspace payload as returned by the canonical workspace query. The API
 * response includes the flexible `scopeItems` array (built-in + custom) in addition
 * to the typed `ProjectWorkspace` base, mirroring the shell's `WorkspaceWithScope`.
 */
export type ProjectWorkspaceWithScope = ProjectWorkspace & { scopeItems: ProjectScopeItem[] };

export interface ScopeAndServicesProps {
  projectId: string;
  project: Project;
  /** Workspace payload including the canonical scopeItems/deliverables/requirements. */
  workspace: ProjectWorkspaceWithScope;
  /** Refreshes the bounded project + workspace queries after mutations. */
  invalidate: () => Promise<void>;
}

/**
 * Scope & Services — the authoritative Project Workspace page for scope, services,
 * deliverables, requirements/exclusions and the scope-related Project Brief fields.
 *
 * Phase-2 read-first page: the normal state is a read view. Editing is explicit:
 * `Edit Scope` (canonical PATCH /api/projects/:id/scope) and `Add / Edit Requirement`
 * (canonical requirement POST/PATCH). Project Brief editing is NOT duplicated here —
 * it stays owned by the existing `Edit Project` authority in the shared project header.
 * Folder management intentionally does NOT appear on this route (it lives on the legacy
 * workspace/folder path until P2-UX-04E Files).
 *
 * Desktop composition (Phase-2 structural target):
 *   page title + operational description + page-level Edit Scope
 *   primary grid: Project Scope | Deliverables | Project Brief
 *   secondary grid: Requirements | Notes / Exclusions
 */
export function ScopeAndServices({
  projectId,
  project,
  workspace,
  invalidate,
}: ScopeAndServicesProps) {
  const { showToast } = useToast();
  const [editingScope, setEditingScope] = useState(false);
  const [drawer, setDrawer] = useState<CollectionKind | null>(null);
  // Shared requirement editing state between the overview preview cards and the
  // full-list drawer, so Edit / Delete reuse the SAME canonical handlers.
  const [editReqId, setEditReqId] = useState<string | null>(null);
  const [deleteReqId, setDeleteReqId] = useState<string | null>(null);
  const [addingRequirement, setAddingRequirement] = useState(false);
  const [draftServices, setDraftServices] = useState<ProjectServiceCode[]>(() =>
    workspace.scopeItems.filter((item) => !item.custom && item.code).map((item) => item.code!),
  );
  const [draftCustomItems, setDraftCustomItems] = useState<ProjectScopeItem[]>(() =>
    workspace.scopeItems.filter((item) => item.custom),
  );
  const [customScopeInput, setCustomScopeInput] = useState('');

  // Single derived presentation authority for the read view. `deliverables` here is the
  // filtered set of CURRENT required canonical deliverables (required === true) — records
  // whose service was deselected remain canonically persisted with required=false and are
  // NOT presented as current project deliverables.
  const view = useMemo(() => scopeServicesView(project, workspace), [project, workspace]);

  const saveScope = useMutation({
    mutationFn: () =>
      apiRequest<{ workspace: ProjectWorkspaceWithScope }>(`/api/projects/${projectId}/scope`, {
        method: 'PATCH',
        body: {
          scopeItems: [
            ...draftServices.map((service) => ({
              code: service,
              label: projectServiceLabels[service],
              custom: false,
            })),
            ...draftCustomItems.map((item) => ({ label: item.label, custom: true })),
          ],
          expectedVersion: project.version,
        },
      }),
    onSuccess: async () => {
      setEditingScope(false);
      await invalidate();
      showToast('Project scope updated.');
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        // A scope version conflict means someone else changed this project while we
        // were editing. The safest Phase-2 recovery is to end the stale edit session:
        // exit edit mode, drop the stale draft, refetch the latest canonical data, and
        // surface the conflict so the user explicitly reviews and re-edits. We must NOT
        // keep the stale draft active or auto-retry, or a second Save could overwrite a
        // newer canonical scope. `editingScope=false` causes the read-mode sync effect
        // below to reinitialize the draft from the freshly-refetched workspace.scopeItems.
        setEditingScope(false);
        setCustomScopeInput('');
        void invalidate();
        showToast(
          'Scope changed elsewhere. The latest scope has been loaded. Review it before editing again.',
          'error',
        );
        return;
      }
      showToast(error instanceof Error ? error.message : 'Scope could not be updated.', 'error');
    },
  });

  // Keep the local scope draft aligned with canonical data whenever the page is in
  // READ mode (not actively editing). This neutralizes any stale draft left over from
  // a 409 conflict: once the conflict exits edit mode and the workspace refetches, the
  // draft is rebuilt from the latest canonical scopeItems. Re-entering Edit therefore
  // always starts from the freshly-refetched scope, never the pre-conflict draft.
  useEffect(() => {
    if (editingScope) return;
    setDraftServices(
      workspace.scopeItems.filter((item) => !item.custom && item.code).map((item) => item.code!),
    );
    setDraftCustomItems(workspace.scopeItems.filter((item) => item.custom));
    setCustomScopeInput('');
  }, [workspace, editingScope]);

  const toggleService = (service: ProjectServiceCode, checked: boolean) => {
    setDraftServices((current) =>
      checked
        ? current.includes(service)
          ? current
          : [...current, service]
        : current.filter((item) => item !== service),
    );
  };

  const addCustomScopeItem = () => {
    const label = customScopeInput.trim();
    if (!label) return;
    if (
      draftCustomItems.some(
        (item) => normalizeScopeLabel(item.label) === normalizeScopeLabel(label),
      )
    ) {
      showToast('That scope item is already in this project.', 'error');
      return;
    }
    setDraftCustomItems((current) => [
      ...current,
      {
        id: `custom:${
          label
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'item'
        }`,
        code: null,
        label,
        custom: true,
      },
    ]);
    setCustomScopeInput('');
  };

  const removeCustomScopeItem = (id: string) => {
    setDraftCustomItems((current) => current.filter((item) => item.id !== id));
  };

  const cancelScopeEdit = () => {
    setDraftServices(
      workspace.scopeItems.filter((item) => !item.custom && item.code).map((item) => item.code!),
    );
    setDraftCustomItems(workspace.scopeItems.filter((item) => item.custom));
    setCustomScopeInput('');
    setEditingScope(false);
  };

  const createRequirement = useMutation({
    mutationFn: (body: unknown) => api.createRequirement(projectId, body),
    onSuccess: async () => {
      await invalidate();
      showToast('Requirement added.');
    },
    onError: (error) => showToast((error as Error).message, 'error'),
  });

  const editRequirement = useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) =>
      api.updateRequirement(projectId, id, body),
    onSuccess: async () => {
      await invalidate();
      showToast('Requirement updated.');
    },
    onError: (error) => showToast((error as Error).message, 'error'),
  });

  const deleteRequirement = useMutation({
    mutationFn: (id: string) => api.deleteRequirement(projectId, id),
    onSuccess: async () => {
      await invalidate();
      showToast('Requirement deleted.');
    },
    onError: (error) => showToast((error as Error).message, 'error'),
  });

  const statusLocked = ['Completed', 'Cancelled'].includes(project.status);

  // Full current canonical collections for the bounded-preview composition and drawer.
  const allServices = workspace.scopeItems;
  const allDeliverables = view.deliverables;
  const allActiveRequirements = [...workspace.requirements]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .filter((item) => item.status !== 'NotRequired');
  const allExclusions = [...workspace.requirements]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .filter((item) => item.status === 'NotRequired');

  return (
    <div className="operations-main-stack scope-and-services-page">
      <ProjectContextHeaderView header={projectContextHeader(project)} />

      <div className="scope-page-header">
        <div>
          <h1>Scope &amp; Services</h1>
          <p>Define project brief, deliverables, technical requirements, and exclusions.</p>
        </div>
        {!editingScope ? (
          <button
            className="button secondary"
            type="button"
            disabled={statusLocked}
            onClick={() => setEditingScope(true)}
          >
            <Pencil size={16} /> Edit Scope
          </button>
        ) : null}
      </div>

      <div className="scope-grid">
        <ProjectScopeCard
          scopeSummary={view.scopeSummary}
          servicesPreview={allServices.slice(0, SCOPE_SERVICES_PREVIEW)}
          servicesTotal={allServices.length}
          editing={editingScope}
          draftServices={draftServices}
          draftCustomItems={draftCustomItems}
          customScopeInput={customScopeInput}
          onCustomScopeInput={setCustomScopeInput}
          onToggleService={toggleService}
          onAddCustom={addCustomScopeItem}
          onRemoveCustom={removeCustomScopeItem}
          onCancelEdit={cancelScopeEdit}
          onSave={() => saveScope.mutate()}
          saving={saveScope.isPending}
          statusLocked={statusLocked}
          onShowAllServices={() => setDrawer('services')}
          onViewFullScope={() => setDrawer('fullScope')}
        />

        <DeliverablesSection
          deliverablesPreview={allDeliverables.slice(0, DELIVERABLES_PREVIEW)}
          deliverablesTotal={allDeliverables.length}
          onShowAll={() => setDrawer('deliverables')}
        />

        <ProjectSummarySection project={project} />

        <RequirementsSection
          requirementsPreview={allActiveRequirements.slice(0, REQUIREMENTS_PREVIEW)}
          requirementsTotal={allActiveRequirements.length}
          editingId={editReqId}
          adding={addingRequirement}
          onStartAdd={() => setAddingRequirement(true)}
          onCancelAdd={() => setAddingRequirement(false)}
          onAdd={(body) => createRequirement.mutate(body)}
          onEditStart={(id) => setEditReqId(id)}
          onEditCancel={() => setEditReqId(null)}
          onEdit={(id, body) => editRequirement.mutate({ id, body })}
          onDeleteStart={(id) => setDeleteReqId(id)}
          onShowAll={() => setDrawer('requirements')}
        />

        <ExclusionsSection
          exclusionsPreview={allExclusions.slice(0, EXCLUSIONS_PREVIEW)}
          exclusionsTotal={allExclusions.length}
          editingId={editReqId}
          onEditStart={(id) => setEditReqId(id)}
          onEditCancel={() => setEditReqId(null)}
          onEdit={(id, body) => editRequirement.mutate({ id, body })}
          onDeleteStart={(id) => setDeleteReqId(id)}
          onShowAll={() => setDrawer('exclusions')}
        />
      </div>

      {drawer ? (
        <CollectionDrawer
          kind={drawer}
          scopeSummary={view.scopeSummary}
          services={allServices}
          deliverables={allDeliverables}
          requirements={allActiveRequirements}
          exclusions={allExclusions}
          editingId={editReqId}
          onEditStart={(id) => setEditReqId(id)}
          onEditCancel={() => setEditReqId(null)}
          onEdit={(id, body) => editRequirement.mutate({ id, body })}
          onDeleteStart={(id) => setDeleteReqId(id)}
          onEditScope={() => {
            setDrawer(null);
            setEditingScope(true);
          }}
          onClose={() => setDrawer(null)}
        />
      ) : null}

      {deleteReqId ? (
        <DeleteRequirementDialog
          title={
            [...allActiveRequirements, ...allExclusions].find((item) => item.id === deleteReqId)
              ?.title ?? ''
          }
          onCancel={() => setDeleteReqId(null)}
          onConfirm={() => {
            deleteRequirement.mutate(deleteReqId);
            setDeleteReqId(null);
          }}
        />
      ) : null}
    </div>
  );
}

function ProjectScopeCard({
  scopeSummary,
  servicesPreview,
  servicesTotal,
  editing,
  draftServices,
  draftCustomItems,
  customScopeInput,
  onCustomScopeInput,
  onToggleService,
  onAddCustom,
  onRemoveCustom,
  onCancelEdit,
  onSave,
  saving,
  statusLocked,
  onShowAllServices,
  onViewFullScope,
}: {
  scopeSummary: { lightingScope: string | null; luxRequirements: string | null };
  servicesPreview: ProjectScopeItem[];
  servicesTotal: number;
  editing: boolean;
  draftServices: ProjectServiceCode[];
  draftCustomItems: ProjectScopeItem[];
  customScopeInput: string;
  onCustomScopeInput: (value: string) => void;
  onToggleService: (service: ProjectServiceCode, checked: boolean) => void;
  onAddCustom: () => void;
  onRemoveCustom: (id: string) => void;
  onCancelEdit: () => void;
  onSave: () => void;
  saving: boolean;
  statusLocked: boolean;
  onShowAllServices: () => void;
  onViewFullScope: () => void;
}) {
  const builtIn = servicesPreview.filter((item) => !item.custom);
  const custom = servicesPreview.filter((item) => item.custom);
  const hasLightingScope = Boolean(scopeSummary.lightingScope);
  const hasLux = Boolean(scopeSummary.luxRequirements);
  const showAllServices = servicesTotal > servicesPreview.length;
  // A long canonical narrative gets a bounded preview + View full scope. Presentation-only.
  const narrativeLong =
    isNarrativeLong(scopeSummary.lightingScope) || isNarrativeLong(scopeSummary.luxRequirements);

  return (
    <section className="content-card scope-card scope-area-scope" aria-label="Project scope">
      <div className="section-toolbar">
        <div>
          <span className="eyebrow">Scope &amp; services</span>
          <h2>Project Scope</h2>
        </div>
      </div>

      {editing ? (
        <div className="scope-editor">
          <div className="workspace-service-grid">
            {projectServiceCodes.map((service) => {
              const selected = draftServices.includes(service);
              return (
                <label className={selected ? 'selected' : ''} key={service}>
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={(event) => onToggleService(service, event.target.checked)}
                  />
                  <span>{selected ? <Check /> : null}</span>
                  <strong>{projectServiceLabels[service]}</strong>
                  <small>{selected ? 'Included in this project' : 'Not required'}</small>
                </label>
              );
            })}
          </div>
          <div className="custom-scope-editor">
            <label className="field">
              Project-specific scope item
              <span className="field-path-control">
                <input
                  value={customScopeInput}
                  onChange={(event) => onCustomScopeInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      onAddCustom();
                    }
                  }}
                  placeholder="e.g. Authority Submission"
                />
                <button className="button secondary" type="button" onClick={onAddCustom}>
                  Add item
                </button>
              </span>
            </label>
            {draftCustomItems.length ? (
              <ul className="custom-scope-list">
                {draftCustomItems.map((item) => (
                  <li key={item.id}>
                    <span>{item.label}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${item.label}`}
                      onClick={() => onRemoveCustom(item.id)}
                    >
                      <X size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="scope-editor-actions">
            <button className="button ghost" type="button" onClick={onCancelEdit}>
              Cancel
            </button>
            <button className="button primary" type="button" disabled={saving} onClick={onSave}>
              {saving ? <LoaderCircle className="spin" /> : <Save />} Save Scope
            </button>
          </div>
        </div>
      ) : (
        <>
          {hasLightingScope ? (
            <>
              <h3>Lighting scope</h3>
              <p
                className={
                  isNarrativeLong(scopeSummary.lightingScope)
                    ? 'muted-copy scope-narrative-preview'
                    : 'muted-copy'
                }
              >
                {scopeSummary.lightingScope}
              </p>
            </>
          ) : null}
          {hasLux ? (
            <>
              <h3>Lux requirements</h3>
              <p
                className={
                  isNarrativeLong(scopeSummary.luxRequirements)
                    ? 'muted-copy scope-narrative-preview'
                    : 'muted-copy'
                }
              >
                {scopeSummary.luxRequirements}
              </p>
            </>
          ) : null}

          {narrativeLong ? (
            <button className="scope-show-all" type="button" onClick={onViewFullScope}>
              <Pencil size={14} /> View full scope
            </button>
          ) : null}

          {builtIn.length ? (
            <>
              <h3>Included services</h3>
              <div className="scope-chips">
                {builtIn.map((item) => (
                  <span key={item.id}>{item.label}</span>
                ))}
              </div>
            </>
          ) : null}

          {custom.length ? (
            <>
              <h3>Custom services</h3>
              <div className="scope-chips">
                {custom.map((item) => (
                  <span key={item.id}>{item.label}</span>
                ))}
              </div>
            </>
          ) : null}

          {showAllServices ? (
            <button className="scope-show-all" type="button" onClick={onShowAllServices}>
              <List size={14} /> Show all ({servicesTotal})
            </button>
          ) : null}

          {!hasLightingScope && !hasLux && !builtIn.length && !custom.length ? (
            <EmptyState
              title="No scope configured yet"
              description="Select services or add project-specific scope items to define what is included in this project."
              action={
                !statusLocked ? (
                  <button className="button secondary" type="button" onClick={() => undefined}>
                    <Pencil size={16} /> Edit Scope
                  </button>
                ) : undefined
              }
            />
          ) : null}
        </>
      )}
    </section>
  );
}

function DeliverablesSection({
  deliverablesPreview,
  deliverablesTotal,
  onShowAll,
}: {
  deliverablesPreview: ProjectDeliverable[];
  deliverablesTotal: number;
  onShowAll: () => void;
}) {
  if (!deliverablesTotal) {
    return (
      <section
        className="content-card scope-card scope-area-deliverables"
        aria-label="Deliverables"
      >
        <span className="eyebrow">Derived from services</span>
        <h2>Deliverables</h2>
        <EmptyState
          title="No deliverables yet"
          description="Deliverables are generated from the services selected in this project. Select services to see the expected deliverables."
        />
      </section>
    );
  }
  const showAll = deliverablesTotal > deliverablesPreview.length;
  return (
    <section className="content-card scope-card scope-area-deliverables" aria-label="Deliverables">
      <span className="eyebrow">Derived from services</span>
      <h2>Deliverables</h2>
      <div className="deliverable-list scope-preview-list">
        {deliverablesPreview.map((deliverable) => (
          <article className="deliverable-row" key={deliverable.id}>
            <span className="deliverable-index">
              {String(deliverable.sortOrder + 1).padStart(2, '0')}
            </span>
            <div className="deliverable-main">
              <h3>{deliverable.title}</h3>
              <small>{deliverable.dueDate ? `Due ${deliverable.dueDate}` : 'No due date'}</small>
            </div>
            <span className="status-badge">{deliverable.status}</span>
          </article>
        ))}
      </div>
      {showAll ? (
        <div className="scope-preview-footer">
          <button className="scope-show-all" type="button" onClick={onShowAll}>
            <List size={14} /> Show all ({deliverablesTotal})
          </button>
        </div>
      ) : null}
    </section>
  );
}

function ProjectSummarySection({ project }: { project: Project }) {
  const commercialValue = formatCommercialValue(
    project.commercialValueMinor,
    project.commercialCurrency,
  );
  const rows: Array<[string, string | null]> = [
    ['CRM Reference', project.crmReference?.trim() || null],
    ['Commercial Value', commercialValue === 'Not set' ? null : commercialValue],
    ['Drawing Reference', project.drawingReference?.trim() || null],
    [
      'Estimated Hours',
      typeof project.estimatedHours === 'number' ? `${project.estimatedHours}h` : null,
    ],
  ];
  const visible = rows.filter(([, value]) => value !== null);
  return (
    <section className="content-card scope-card scope-area-summary" aria-label="Project summary">
      <div className="section-toolbar">
        <div>
          <span className="eyebrow">Scope &amp; coordination</span>
          <h2>Project Summary</h2>
        </div>
      </div>
      {visible.length ? (
        <dl className="detail-list">
          {visible.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <EmptyState
          title="No project summary fields set"
          description="Add CRM reference, commercial value, drawing reference, or estimated hours via Edit Project."
        />
      )}
      <p className="muted-copy">
        Editing these fields is handled by the existing Edit Project action in the project header.
      </p>
    </section>
  );
}

function RequirementsSection({
  requirementsPreview,
  requirementsTotal,
  editingId,
  adding,
  onStartAdd,
  onCancelAdd,
  onAdd,
  onEditStart,
  onEditCancel,
  onEdit,
  onDeleteStart,
  onShowAll,
}: {
  requirementsPreview: ProjectRequirement[];
  requirementsTotal: number;
  editingId: string | null;
  adding: boolean;
  onStartAdd: () => void;
  onCancelAdd: () => void;
  onAdd: (body: unknown) => void;
  onEditStart: (id: string) => void;
  onEditCancel: () => void;
  onEdit: (id: string, body: unknown) => void;
  onDeleteStart: (id: string) => void;
  onShowAll: () => void;
}) {
  const showAll = requirementsTotal > requirementsPreview.length;

  return (
    <section className="content-card scope-card scope-area-requirements" aria-label="Requirements">
      <div className="section-toolbar">
        <div>
          <span className="eyebrow">Coordination inputs</span>
          <h2>Requirements</h2>
          <p>Information and conditions needed to deliver the scope.</p>
        </div>
        {!adding ? (
          <button className="button secondary" type="button" onClick={onStartAdd}>
            <Plus size={16} /> Add Requirement
          </button>
        ) : null}
      </div>

      {adding ? (
        <RequirementForm
          onCancel={onCancelAdd}
          onSubmit={(body) => {
            onAdd(body);
            onCancelAdd();
          }}
        />
      ) : null}

      {requirementsPreview.length ? (
        <div className="operations-list scope-preview-list">
          {requirementsPreview.map((item) =>
            editingId === item.id ? (
              <RequirementForm
                key={item.id}
                initial={item}
                onCancel={onEditCancel}
                onSubmit={(body) => {
                  onEdit(item.id, body);
                  onEditCancel();
                }}
              />
            ) : (
              <RequirementRow
                key={item.id}
                item={item}
                onEdit={() => onEditStart(item.id)}
                onDelete={() => onDeleteStart(item.id)}
              />
            ),
          )}
        </div>
      ) : (
        <EmptyState
          title="No active requirements"
          description="Add requirements for information or conditions the design team needs from the client, consultant, or other sources."
        />
      )}

      {showAll ? (
        <div className="scope-preview-footer">
          <button className="scope-show-all" type="button" onClick={onShowAll}>
            <List size={14} /> Show all ({requirementsTotal})
          </button>
        </div>
      ) : null}
    </section>
  );
}

function ExclusionsSection({
  exclusionsPreview,
  exclusionsTotal,
  editingId,
  onEditStart,
  onEditCancel,
  onEdit,
  onDeleteStart,
  onShowAll,
}: {
  exclusionsPreview: ProjectRequirement[];
  exclusionsTotal: number;
  editingId: string | null;
  onEditStart: (id: string) => void;
  onEditCancel: () => void;
  onEdit: (id: string, body: unknown) => void;
  onDeleteStart: (id: string) => void;
  onShowAll: () => void;
}) {
  if (!exclusionsTotal) {
    return (
      <section
        className="content-card scope-card scope-area-exclusions"
        aria-label="Notes & exclusions"
      >
        <span className="eyebrow">Not required</span>
        <h2>Notes / Exclusions</h2>
        <EmptyState
          title="No exclusions recorded"
          description="Items marked Not Required appear here as exclusions from the scope."
        />
      </section>
    );
  }
  const showAll = exclusionsTotal > exclusionsPreview.length;

  return (
    <section
      className="content-card scope-card scope-area-exclusions"
      aria-label="Notes & exclusions"
    >
      <span className="eyebrow">Not required</span>
      <h2>Notes / Exclusions</h2>
      <div className="operations-list scope-preview-list">
        {exclusionsPreview.map((item) =>
          editingId === item.id ? (
            <RequirementForm
              key={item.id}
              initial={item}
              onCancel={onEditCancel}
              onSubmit={(body) => {
                onEdit(item.id, body);
                onEditCancel();
              }}
            />
          ) : (
            <RequirementRow
              key={item.id}
              item={item}
              onEdit={() => onEditStart(item.id)}
              onDelete={() => onDeleteStart(item.id)}
              exclusion
            />
          ),
        )}
      </div>

      {showAll ? (
        <div className="scope-preview-footer">
          <button className="scope-show-all" type="button" onClick={onShowAll}>
            <List size={14} /> Show all ({exclusionsTotal})
          </button>
        </div>
      ) : null}
    </section>
  );
}

function RequirementRow({
  item,
  onEdit,
  onDelete,
  exclusion = false,
}: {
  item: ProjectRequirement;
  onEdit: () => void;
  onDelete: () => void;
  exclusion?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <article className="operation-row requirement-row">
      <span className="operation-icon">{exclusion ? <X size={16} /> : <Check size={16} />}</span>
      <div className="requirement-main">
        <strong className="requirement-title">{item.title}</strong>
        {exclusion ? (
          item.notes ? (
            <p className="requirement-notes">{item.notes}</p>
          ) : null
        ) : (
          <>
            <div className="requirement-meta">
              <span>{item.category}</span>
              <span>{item.status}</span>
              <span>{item.impact} impact</span>
              {item.dueDate ? <span>Due {item.dueDate}</span> : null}
            </div>
            {item.notes ? <p className="requirement-notes">{item.notes}</p> : null}
          </>
        )}
      </div>
      <div className="requirement-menu">
        <button
          className="icon-button"
          type="button"
          aria-label={`Actions for ${item.title}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <MoreHorizontal size={16} />
        </button>
        {menuOpen ? (
          <div
            className="requirement-menu-popover"
            role="menu"
            aria-label={`Actions for ${item.title}`}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onEdit();
              }}
            >
              <Pencil size={14} /> Edit
            </button>
            <button
              type="button"
              role="menuitem"
              className="danger"
              onClick={() => {
                setMenuOpen(false);
                onDelete();
              }}
            >
              <Trash2 size={14} /> Delete Requirement
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function DeleteRequirementDialog({
  title,
  onCancel,
  onConfirm,
}: {
  title: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="operation-modal-backdrop" role="presentation">
      <section
        className="operation-modal delete-requirement-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Delete requirement"
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">Destructive action</span>
            <h2>Delete requirement?</h2>
          </div>
        </div>
        <p className="muted-copy">
          This permanently removes <strong>{title}</strong> from the project. This action cannot be
          undone.
        </p>
        <div className="scope-editor-actions">
          <button className="button ghost" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="button danger" type="button" onClick={onConfirm}>
            <Trash2 size={14} /> Delete
          </button>
        </div>
      </section>
    </div>
  );
}

function RequirementForm({
  initial,
  onCancel,
  onSubmit,
}: {
  initial?: ProjectRequirement;
  onCancel: () => void;
  onSubmit: (body: unknown) => void;
}) {
  const [form, setForm] = useState(() => ({
    category: initial?.category ?? 'Client Information',
    title: initial?.title ?? '',
    details: initial?.details ?? '',
    requestedFrom: initial?.requestedFrom ?? '',
    dueDate: initial?.dueDate ?? '',
    status: initial?.status ?? 'Missing',
    impact: initial?.impact ?? 'Medium',
    sourceType: 'Manual' as const,
    sourceReference: initial?.sourceReference ?? '',
    notes: initial?.notes ?? '',
    sortOrder: initial?.sortOrder ?? 0,
  }));
  const update = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  return (
    <div className="scope-editor">
      <div className="compact-form-grid">
        <label className="field">
          Title
          <input
            value={form.title}
            onChange={(event) => update('title', event.target.value)}
            placeholder="e.g. Confirm emergency lighting standard"
          />
        </label>
        <label className="field">
          Category
          <input
            value={form.category}
            onChange={(event) => update('category', event.target.value)}
          />
        </label>
      </div>
      <label className="field">
        Details
        <textarea
          rows={2}
          value={form.details}
          onChange={(event) => update('details', event.target.value)}
        />
      </label>
      <div className="compact-form-grid">
        <label className="field">
          Status
          <select
            value={form.status}
            onChange={(event) =>
              update('status', event.target.value as ProjectRequirement['status'])
            }
          >
            {['Missing', 'Requested', 'Received', 'NotRequired'].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Impact
          <select
            value={form.impact}
            onChange={(event) =>
              update('impact', event.target.value as ProjectRequirement['impact'])
            }
          >
            {['Low', 'Medium', 'High', 'Blocking'].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        Requested from
        <input
          value={form.requestedFrom}
          onChange={(event) => update('requestedFrom', event.target.value)}
        />
      </label>
      <label className="field">
        Notes
        <textarea
          rows={2}
          value={form.notes}
          onChange={(event) => update('notes', event.target.value)}
          placeholder="e.g. Excluded from scope"
        />
      </label>
      <div className="scope-editor-actions">
        <button className="button ghost" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="button primary"
          type="button"
          disabled={!form.title.trim()}
          onClick={() =>
            onSubmit({
              ...form,
              requestedAt: initial?.requestedAt ?? null,
              dueDate: form.dueDate || null,
            })
          }
        >
          <Save /> {initial ? 'Save Requirement' : 'Add Requirement'}
        </button>
      </div>
    </div>
  );
}

/**
 * Right-side full-list collection drawer for the bounded-preview grammar.
 *
 * This is a Scope-local pilot: it reuses no global drawer component (the existing
 * `AssignmentDrawer` is project-specific). It shows the complete current canonical
 * collection for one section, with simple local search and — for requirements —
 * the SAME edit/delete handlers used in the overview preview cards.
 */
function CollectionDrawer({
  kind,
  scopeSummary,
  services,
  deliverables,
  requirements,
  exclusions,
  editingId,
  onEditStart,
  onEditCancel,
  onEdit,
  onDeleteStart,
  onEditScope,
  onClose,
}: {
  kind: CollectionKind;
  scopeSummary: { lightingScope: string | null; luxRequirements: string | null };
  services: ProjectScopeItem[];
  deliverables: ProjectDeliverable[];
  requirements: ProjectRequirement[];
  exclusions: ProjectRequirement[];
  editingId: string | null;
  onEditStart: (id: string) => void;
  onEditCancel: () => void;
  onEdit: (id: string, body: unknown) => void;
  onDeleteStart: (id: string) => void;
  onEditScope: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');

  const isFullScope = kind === 'fullScope';

  const title = isFullScope
    ? 'Project Scope'
    : kind === 'services'
      ? 'All Services'
      : kind === 'deliverables'
        ? 'All Deliverables'
        : kind === 'requirements'
          ? 'All Requirements'
          : 'All Notes / Exclusions';

  const count = isFullScope
    ? 0
    : kind === 'services'
      ? services.length
      : kind === 'deliverables'
        ? deliverables.length
        : kind === 'requirements'
          ? requirements.length
          : exclusions.length;

  const normalized = query.trim().toLowerCase();

  const filterReq = (items: ProjectRequirement[]) =>
    normalized
      ? items.filter(
          (item) =>
            item.title.toLowerCase().includes(normalized) ||
            item.notes.toLowerCase().includes(normalized),
        )
      : items;

  const filteredServices = normalized
    ? services.filter((item) => item.label.toLowerCase().includes(normalized))
    : services;
  const filteredDeliverables = normalized
    ? deliverables.filter((item) => item.title.toLowerCase().includes(normalized))
    : deliverables;
  const filteredRequirements = filterReq(requirements);
  const filteredExclusions = filterReq(exclusions);

  return (
    <div className="scope-drawer-backdrop" role="presentation">
      <aside className="scope-collection-drawer" role="dialog" aria-modal="true" aria-label={title}>
        <header className="scope-drawer-header">
          <div>
            <span className="eyebrow">{isFullScope ? 'Narrative' : 'Collection'}</span>
            <h2>{title}</h2>
            {isFullScope ? (
              <p>Full project scope narrative</p>
            ) : (
              <p>
                {count} {count === 1 ? 'item' : 'items'}
              </p>
            )}
          </div>
          {kind === 'services' ? (
            <button className="button secondary" type="button" onClick={onEditScope}>
              <Pencil size={14} /> Edit Scope
            </button>
          ) : null}
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </header>

        {!isFullScope ? (
          <div className="scope-drawer-search">
            <Search size={14} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${title.toLowerCase()}…`}
              aria-label={`Search ${title}`}
            />
          </div>
        ) : null}

        <div className="scope-drawer-body">
          {isFullScope ? (
            <div className="scope-drawer-fullscope">
              {scopeSummary.lightingScope ? (
                <div>
                  <h3>Lighting scope</h3>
                  <p>{scopeSummary.lightingScope}</p>
                </div>
              ) : null}
              {scopeSummary.luxRequirements ? (
                <div>
                  <h3>Lux requirements</h3>
                  <p>{scopeSummary.luxRequirements}</p>
                </div>
              ) : null}
            </div>
          ) : null}
          {kind === 'services' ? (
            <div className="scope-drawer-services">
              {filteredServices.length ? (
                filteredServices.map((item) => (
                  <div className="scope-drawer-service" key={item.id}>
                    <span className="operation-icon">
                      {item.custom ? <Layers size={16} /> : <Check size={16} />}
                    </span>
                    <div>
                      <strong>{item.label}</strong>
                      <small>{item.custom ? 'Custom service' : 'Built-in service'}</small>
                    </div>
                  </div>
                ))
              ) : (
                <EmptyState title="No services match" description="Try a different search." />
              )}
            </div>
          ) : null}

          {kind === 'deliverables' ? (
            <div className="deliverable-list">
              {filteredDeliverables.length ? (
                filteredDeliverables.map((deliverable) => (
                  <article className="deliverable-row" key={deliverable.id}>
                    <span className="deliverable-index">
                      {String(deliverable.sortOrder + 1).padStart(2, '0')}
                    </span>
                    <div className="deliverable-main">
                      <h3>{deliverable.title}</h3>
                      <small>
                        {deliverable.dueDate ? `Due ${deliverable.dueDate}` : 'No due date'}
                      </small>
                    </div>
                    <span className="status-badge">{deliverable.status}</span>
                  </article>
                ))
              ) : (
                <EmptyState title="No deliverables match" description="Try a different search." />
              )}
            </div>
          ) : null}

          {kind === 'requirements' ? (
            <div className="operations-list">
              {filteredRequirements.length ? (
                filteredRequirements.map((item) =>
                  editingId === item.id ? (
                    <RequirementForm
                      key={item.id}
                      initial={item}
                      onCancel={onEditCancel}
                      onSubmit={(body) => {
                        onEdit(item.id, body);
                        onEditCancel();
                      }}
                    />
                  ) : (
                    <RequirementRow
                      key={item.id}
                      item={item}
                      onEdit={() => onEditStart(item.id)}
                      onDelete={() => onDeleteStart(item.id)}
                    />
                  ),
                )
              ) : (
                <EmptyState title="No requirements match" description="Try a different search." />
              )}
            </div>
          ) : null}

          {kind === 'exclusions' ? (
            <div className="operations-list">
              {filteredExclusions.length ? (
                filteredExclusions.map((item) =>
                  editingId === item.id ? (
                    <RequirementForm
                      key={item.id}
                      initial={item}
                      onCancel={onEditCancel}
                      onSubmit={(body) => {
                        onEdit(item.id, body);
                        onEditCancel();
                      }}
                    />
                  ) : (
                    <RequirementRow
                      key={item.id}
                      item={item}
                      onEdit={() => onEditStart(item.id)}
                      onDelete={() => onDeleteStart(item.id)}
                      exclusion
                    />
                  ),
                )
              ) : (
                <EmptyState title="No exclusions match" description="Try a different search." />
              )}
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
