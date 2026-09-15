import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  Ban,
  Check,
  ChevronDown,
  CircleCheck,
  Clipboard,
  Download,
  FileDown,
  FileSpreadsheet,
  FolderOpen,
  Import,
  LayoutList,
  LoaderCircle,
  MoreHorizontal,
  PackageCheck,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  canChangeProjectReference,
  canEditProjectField,
  complexities,
  deliverableStatusLabels,
  designStages,
  duplicateLuminaireTagMessage,
  getAllowedPersonalTransitions,
  luminaireInputModeOptions,
  normalizeLuminaireTag,
  normalizeScopeLabel,
  priorities,
  projectServiceCodes,
  projectServiceLabels,
  type AppUser,
  type Complexity,
  type DeliverableStatus,
  type DesignStage,
  type FolderNodePreset,
  type LuminaireRecord,
  type OutputColumn,
  type PdfPaperSize,
  type Priority,
  type Project,
  type ProjectOutputFolders,
  type ProjectScopeItem,
  type ProjectServiceCode,
  type ProjectStatus,
  type ProjectType,
  type ProjectWorkspace,
} from '@scli/domain';
import type { LuminaireRecordInput, UpdateProjectInput } from '@scli/contracts';
import { api, apiRequest, ApiError } from '../api';
import { useAppContext } from '../app-context';
import {
  commercialValueInputFromMinor,
  formatCommercialValue,
  parseCommercialValueInput,
} from '../commercial-value';
import { CommercialValueFields } from '../components/commercial-value-fields';
import { ProjectTypeSelect } from '../components/project-type-select';
import { desktop } from '../desktop';
import { workspaceDateKey } from '../local-date';
import { personalStatusDescription, personalStatusLabel } from '../personal-status';
import { PROJECT_ROUTE_TO_SECTION, PROJECT_PLACEHOLDER_TITLES } from '../navigation';
import { StructuralPlaceholder } from '../components/structural-placeholder';
import { salesTone } from '../sales-color';
import { useToast } from '../components/toast';
import { RevisionPackageBuilder } from '../components/revision-package-builder';
import { LuminaireImportCenter } from '../components/luminaire-import-center';
import {
  FolderStructureEditor,
  ManageStructureDrawer,
  type ManageStructureWorkspace,
} from '../components/folder-structure-editor';
import { LocalIntelligenceCenter } from '../components/local-intelligence-center';
import { WorkSessionHistory } from '../components/work-session-history';
import {
  Deadline,
  EmptyState,
  ErrorState,
  LoadingState,
  PriorityBadge,
  ProgressBar,
  StatusBadge,
  formatDate,
} from '../components/ui';
import {
  ActionsModule,
  ActivityModule,
  ContactsModule,
  InformationModule,
  MeetingsModule,
  ProjectHealthPanel,
  RevisionsFilesModule,
  ReviewsModule,
} from '../components/project-operations';
import { ProjectSummary, ProjectContextHeaderView } from '../components/project-summary';
import { ScopeAndServices } from '../components/scope-and-services';
import { ProjectTimeline } from '../components/project-timeline';
import { projectContextHeader } from '../project-summary-model';

type Tab =
  | 'overview'
  | 'intelligence'
  | 'scope'
  | 'workspace'
  | 'information'
  | 'actions'
  | 'meetings'
  | 'reviews'
  | 'contacts'
  | 'deliverables'
  | 'luminaires'
  | 'assets'
  | 'outputs'
  | 'revisions'
  | 'package'
  | 'exports';

const emptyLuminaire: LuminaireRecordInput = {
  tag: '',
  category: '',
  imagePath: '',
  description: '',
  manufacturer: '',
  model: '',
  wattage: '',
  lumens: '',
  lightColor: '',
  cri: '',
  beamAngle: '',
  ipRating: '',
  mounting: '',
  cutout: '',
  driver: '',
  control: '',
  emergency: 'No',
  datasheetPath: '',
  location: '',
  unit: 'No.',
  quantity: 0,
  notes: '',
  sourceName: '',
  dimensions: '',
  bodyColorFinish: '',
};

const designStageLabels: Record<DesignStage, string> = {
  Concept: 'Concept',
  SchematicDesign: 'Schematic Design',
  DetailedDesign: 'Detailed Design',
  Tender: 'Tender',
  Construction: 'Construction',
  AsBuilt: 'As Built',
};

function recordInput(record: LuminaireRecord): LuminaireRecordInput {
  const {
    id: _id,
    projectId: _projectId,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...input
  } = record;
  void _id;
  void _projectId;
  void _createdAt;
  void _updatedAt;
  return input;
}

function displayValue(record: LuminaireRecord, fieldKey: string): string {
  const value = record[fieldKey as keyof LuminaireRecord];
  if (typeof value === 'number') return value.toLocaleString('en-AE', { maximumFractionDigits: 2 });
  return typeof value === 'string' ? value : '';
}

interface MetadataDraft {
  projectName: string;
  clientName: string;
  crmReference: string;
  commercialValueAmount: string;
  commercialCurrency: string;
  projectType: string;
  description: string;
  siteLocation: string;
  designStage: DesignStage;
  lightingScope: string;
  luxRequirements: string;
  drawingReference: string;
  priority: Priority;
  complexity: Complexity;
  estimatedHours: number;
  progressPercent: number;
  requiredDeliveryDate: string;
}

function luminaireInputModeLabel(value: Project['luminaireInputMode']): string {
  if (value === undefined) return 'Not recorded';
  return (
    luminaireInputModeOptions.find((option) => option.value === value)?.label ?? 'Not recorded'
  );
}

function metadataDraftFromProject(project: Project): MetadataDraft {
  const commercialValue = commercialValueInputFromMinor(
    project.commercialValueMinor,
    project.commercialCurrency,
  );
  return {
    projectName: project.projectName,
    clientName: project.clientName,
    crmReference: project.crmReference ?? '',
    commercialValueAmount: commercialValue.amount,
    commercialCurrency: commercialValue.currency,
    projectType: project.projectType,
    description: project.description,
    siteLocation: project.siteLocation,
    designStage: project.designStage,
    lightingScope: project.lightingScope,
    luxRequirements: project.luxRequirements,
    drawingReference: project.drawingReference,
    priority: project.priority,
    complexity: project.complexity,
    estimatedHours: project.estimatedHours,
    progressPercent: project.progressPercent,
    requiredDeliveryDate: project.requiredDeliveryDate,
  };
}

function metadataPatch(project: Project, draft: MetadataDraft, actor: AppUser): UpdateProjectInput {
  const patch: UpdateProjectInput = { expectedVersion: project.version };
  const candidates: Array<[keyof UpdateProjectInput, unknown]> = [
    ['projectName', draft.projectName],
    ['clientName', draft.clientName],
    ['crmReference', draft.crmReference.trim() || null],
    ['projectType', draft.projectType],
    ['description', draft.description],
    ['siteLocation', draft.siteLocation],
    ['designStage', draft.designStage],
    ['lightingScope', draft.lightingScope],
    ['luxRequirements', draft.luxRequirements],
    ['drawingReference', draft.drawingReference],
    ['priority', draft.priority],
    ['complexity', draft.complexity],
    ['estimatedHours', draft.estimatedHours],
    ['progressPercent', draft.progressPercent],
    ['requiredDeliveryDate', draft.requiredDeliveryDate],
  ];
  for (const [field, value] of candidates) {
    if (!canEditProjectField(actor, project, field as keyof Project)) continue;
    if (project[field as keyof Project] === value) continue;
    (patch as Record<string, unknown>)[field] = value;
  }

  if (
    canEditProjectField(actor, project, 'commercialValueMinor') &&
    canEditProjectField(actor, project, 'commercialCurrency')
  ) {
    const commercialValue = parseCommercialValueInput(
      draft.commercialValueAmount,
      draft.commercialCurrency,
    );
    if (!commercialValue.ok) throw new Error(commercialValue.error);
    const desiredMinor = commercialValue.value.commercialValueMinor;
    const desiredCurrency = commercialValue.value.commercialCurrency;
    const currentPairIsSet =
      project.commercialValueMinor !== null &&
      project.commercialValueMinor !== undefined &&
      project.commercialCurrency !== null &&
      project.commercialCurrency !== undefined;
    if (desiredMinor === undefined || desiredCurrency === undefined) {
      if (currentPairIsSet) {
        patch.commercialValueMinor = null;
        patch.commercialCurrency = null;
      }
    } else if (
      desiredMinor !== project.commercialValueMinor ||
      desiredCurrency !== project.commercialCurrency
    ) {
      patch.commercialValueMinor = desiredMinor;
      patch.commercialCurrency = desiredCurrency;
    }
  }
  return patch;
}

export function PersonalProjectDetailsScreen() {
  const { id = '', section } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { currentUser } = useAppContext();
  const isPlaceholderSection = Boolean(section && PROJECT_PLACEHOLDER_TITLES[section]);
  // P2-UX-04A-H1: Summary and Workflow are distinct route-owned views sharing
  // the Project Context Header. The URL/sidebar route is the single navigation
  // authority; the active view is derived from the `:section` param and is never
  // an independent second navigation state.
  const viewMode: 'summary' | 'workflow' | 'overview' =
    section === 'summary' ? 'summary' : section === 'workflow' ? 'workflow' : 'overview';
  // The URL/sidebar route is the single navigation authority for the project
  // section. The active workspace view is derived from the `:section` param and
  // is never an independent second navigation state. `/projects/:id` (no
  // section) boots into the Overview/Summary view.
  const tab: Tab =
    section && PROJECT_ROUTE_TO_SECTION[section]
      ? (PROJECT_ROUTE_TO_SECTION[section] as Tab)
      : 'overview';
  const [editor, setEditor] = useState<LuminaireRecord | 'new' | null>(null);
  const [luminaire, setLuminaire] = useState<LuminaireRecordInput>(emptyLuminaire);
  const [scheduleColumns, setScheduleColumns] = useState<OutputColumn[]>([]);
  const [boqColumns, setBoqColumns] = useState<OutputColumn[]>([]);
  const [pdfPaperSize, setPdfPaperSize] = useState<PdfPaperSize>('Auto');
  const [importSource, setImportSource] = useState<'AutoCadCsv' | 'DialuxCsv' | null>(null);
  const [metadataEditing, setMetadataEditing] = useState(false);
  const [metadataDraft, setMetadataDraft] = useState<MetadataDraft | null>(null);
  const [referenceDialogOpen, setReferenceDialogOpen] = useState(false);
  const [proposedReference, setProposedReference] = useState('');
  const projectQuery = useQuery({
    queryKey: ['project', id],
    queryFn: () => api.project(id),
    enabled: Boolean(id),
  });
  const workspaceQuery = useQuery({
    queryKey: ['project-workspace', id],
    queryFn: () => api.projectWorkspace(id),
    enabled: Boolean(id),
  });
  const workflowHistoryQuery = useQuery({
    queryKey: ['project-workflow-history', id],
    queryFn: () => api.workflowHistory(id),
    enabled: Boolean(id),
  });
  const salesQuery = useQuery({ queryKey: ['sales-users'], queryFn: api.salesUsers });
  const projectTypesQuery = useQuery({
    queryKey: ['project-type-catalogue'],
    queryFn: api.projectTypeCatalogue,
  });
  const project = projectQuery.data;
  const workspace = workspaceQuery.data;

  useEffect(() => {
    if (!workspace) return;
    setScheduleColumns(workspace.lightingPackage.scheduleColumns);
    setBoqColumns(workspace.lightingPackage.boqColumns);
    setPdfPaperSize(workspace.lightingPackage.pdfPaperSize);
  }, [workspace]);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['project', id] }),
      queryClient.invalidateQueries({ queryKey: ['project-workspace', id] }),
      queryClient.invalidateQueries({ queryKey: ['project-workflow-history', id] }),
      queryClient.invalidateQueries({ queryKey: ['projects'] }),
      queryClient.invalidateQueries({ queryKey: ['personal-operations'] }),
      queryClient.invalidateQueries({ queryKey: ['workspace-search'] }),
    ]);
  };

  const statusMutation = useMutation({
    mutationFn: ({ status, reason }: { status: ProjectStatus; reason?: string }) =>
      api.changeStatus(id, {
        status,
        ...(reason !== undefined ? { reason } : {}),
        expectedCurrentStatus: project?.status,
      }),
    onSuccess: async (updated) => {
      await invalidate();
      showToast(`Project moved to ${personalStatusLabel(updated.status)}.`);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        void invalidate();
        showToast('Project status changed. The latest status has been loaded.', 'error');
        return;
      }
      showToast(error instanceof Error ? error.message : 'Status update failed.', 'error');
    },
  });
  const salesMutation = useMutation({
    mutationFn: (salesOwnerId: string) =>
      api.updateProject(id, {
        salesOwnerId,
        auditReason: 'Updated from the personal Sales Directory.',
        expectedVersion: project?.version,
      }),
    onSuccess: async (updated) => {
      await invalidate();
      showToast(`Salesperson changed to ${updated.salesOwnerNameSnapshot}.`);
    },
    onError: (error) => showToast((error as Error).message, 'error'),
  });
  const metadataMutation = useMutation({
    mutationFn: (draft: MetadataDraft) => {
      if (!project) throw new Error('Project is not loaded.');
      return api.updateProject(id, metadataPatch(project, draft, currentUser));
    },
    onSuccess: async () => {
      await invalidate();
      setMetadataEditing(false);
      setMetadataDraft(null);
      showToast('Project details saved.');
    },
    onError: (error) =>
      showToast(
        error instanceof Error ? error.message : 'Project details could not be saved.',
        'error',
      ),
  });
  const referenceMutation = useMutation({
    mutationFn: (projectCode: string) => {
      if (!project) throw new Error('Project is not loaded.');
      return apiRequest<{ project: Project; folderRenamed: boolean; recoveryRequired: boolean }>(
        `/api/projects/${id}/reference`,
        { method: 'POST', body: { projectCode, expectedVersion: project.version } },
      );
    },
    onSuccess: async (result) => {
      await invalidate();
      setReferenceDialogOpen(false);
      setProposedReference('');
      showToast(
        result.folderRenamed
          ? 'Project reference updated and the managed folder was renamed.'
          : 'Project reference updated.',
      );
    },
    onError: (error) =>
      showToast(
        error instanceof Error ? error.message : 'Project reference could not be changed.',
        'error',
      ),
  });
  const folderMutation = useMutation({
    mutationFn: () => api.createProjectFolders(id, {}),
    onSuccess: async (result) => {
      await invalidate();
      showToast(`Project folder created with ${result.createdFolderCount} folders.`);
      if (desktop.available()) void desktop.openPath(result.folderPath);
    },
    onError: (error) =>
      showToast(
        error instanceof Error ? error.message : 'Project folder could not be created.',
        'error',
      ),
  });
  const archiveMutation = useMutation({
    mutationFn: () => api.archiveProject(id),
    onSuccess: async () => {
      await invalidate();
      showToast('Project archived. Its linked folder and files were not changed.');
    },
    onError: (error) => showToast((error as Error).message, 'error'),
  });
  const restoreMutation = useMutation({
    mutationFn: () => api.restoreProject(id),
    onSuccess: async (updated) => {
      await invalidate();
      showToast(`Project restored to ${personalStatusLabel(updated.status)}.`);
    },
    onError: (error) => showToast((error as Error).message, 'error'),
  });
  const removeProjectMutation = useMutation({
    mutationFn: (confirmation: string) => api.removeProjectFromWorkspace(id, confirmation),
    onSuccess: (removed) => {
      showToast(
        removed.folderUntouched
          ? 'Project removed from the app. The original folder remains untouched.'
          : 'Project removed from the app.',
      );
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      navigate('/archive');
    },
    onError: (error) => showToast((error as Error).message, 'error'),
  });
  const deliverableMutation = useMutation({
    mutationFn: ({
      deliverableId,
      status,
      progressPercent,
    }: {
      deliverableId: string;
      status: DeliverableStatus;
      progressPercent: number;
    }) => api.updateDeliverable(id, deliverableId, { status, progressPercent }),
    onSuccess: invalidate,
    onError: (error) =>
      showToast(error instanceof Error ? error.message : 'Deliverable update failed.', 'error'),
  });
  const luminaireMutation = useMutation({
    mutationFn: () => {
      const editedLuminaireId = editor === 'new' ? null : editor?.id;
      const normalizedTag = normalizeLuminaireTag(luminaire.tag);
      const collision = workspace?.luminaires.find(
        (record) =>
          record.id !== editedLuminaireId && normalizeLuminaireTag(record.tag) === normalizedTag,
      );
      if (collision) throw new Error(duplicateLuminaireTagMessage(collision.tag));
      return editor === 'new'
        ? api.addLuminaire(id, luminaire)
        : api.updateLuminaire(id, editor!.id, luminaire);
    },
    onSuccess: async () => {
      await invalidate();
      setEditor(null);
      showToast('Luminaire saved.');
    },
    onError: (error) =>
      showToast(error instanceof Error ? error.message : 'Luminaire could not be saved.', 'error'),
  });
  const deleteMutation = useMutation({
    mutationFn: (luminaireId: string) => api.deleteLuminaire(id, luminaireId),
    onSuccess: async () => {
      await invalidate();
      showToast('Luminaire removed.');
    },
    onError: (error) =>
      showToast(
        error instanceof Error ? error.message : 'Luminaire could not be removed.',
        'error',
      ),
  });
  const columnsMutation = useMutation({
    mutationFn: () => api.updateLightingPackage(id, { scheduleColumns, boqColumns, pdfPaperSize }),
    onSuccess: async () => {
      await invalidate();
      showToast('Output columns and PDF paper size saved.');
    },
    onError: (error) =>
      showToast(
        error instanceof Error ? error.message : 'Column setup could not be saved.',
        'error',
      ),
  });
  const exportMutation = useMutation({
    mutationFn: () =>
      api.exportLightingPackage(id, {
        revision: String((workspace?.exports[0]?.revision ?? 0) + 1).padStart(2, '0'),
        issueStatus: project?.status === 'Issued' ? 'Issued' : 'Preliminary',
        issueDate: workspaceDateKey(),
      }),
    onSuccess: async (result) => {
      await invalidate();
      navigate(`/projects/${id}/revisions`);
      showToast(`Schedule, BOQ and ${result.datasheetCount} datasheets exported.`);
    },
    onError: (error) =>
      showToast(error instanceof Error ? error.message : 'Export failed.', 'error'),
  });

  const visibleSchedule = useMemo(
    () =>
      [...scheduleColumns]
        .filter((column) => column.visible)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [scheduleColumns],
  );

  if (projectQuery.isLoading || workspaceQuery.isLoading)
    return <LoadingState label="Opening project workspace…" />;
  if (projectQuery.error || workspaceQuery.error || !project || !workspace) {
    return (
      <ErrorState
        message={
          (projectQuery.error ?? (workspaceQuery.error as Error))?.message ??
          'Project workspace is not available.'
        }
        onRetry={() => {
          void projectQuery.refetch();
          void workspaceQuery.refetch();
        }}
      />
    );
  }

  return (
    <>
      <header className="personal-project-hero">
        <div>
          <div className="project-card-top">
            <span className="project-code" title={project.projectCode}>
              {project.projectCode}
            </span>
            <PriorityBadge priority={project.priority} />
          </div>
          <h1 title={project.projectName}>{project.projectName}</h1>
          <p title={`${project.clientName} · ${project.siteLocation}`}>
            {project.clientName} · {project.siteLocation}
          </p>
          <div className="project-card-badges">
            <StatusBadge status={project.status} label={personalStatusLabel(project.status)} />
            <Deadline date={project.requiredDeliveryDate} />
            <span
              className={`sales-owner-chip sales-chip ${salesTone(project.salesOwnerId || project.salesOwnerNameSnapshot)}`}
              title={`Sales · ${project.salesOwnerNameSnapshot || 'Direct'}`}
            >
              Sales · {project.salesOwnerNameSnapshot || 'Direct'}
            </span>
          </div>
        </div>
        <div className="project-hero-actions">
          <PersonalWorkflowControl
            project={project}
            pending={statusMutation.isPending}
            onTransition={(target, reason) =>
              statusMutation.mutate({ status: target, ...(reason !== undefined ? { reason } : {}) })
            }
          />
          <label className="status-control">
            <span>Salesperson</span>
            <select
              value={project.salesOwnerId}
              disabled={
                salesMutation.isPending || ['Completed', 'Cancelled'].includes(project.status)
              }
              onChange={(event) => salesMutation.mutate(event.target.value)}
            >
              {!salesQuery.data?.some((item) => item.id === project.salesOwnerId) ? (
                <option value={project.salesOwnerId}>
                  {project.salesOwnerNameSnapshot || 'Direct'}
                </option>
              ) : null}
              {salesQuery.data?.map((salesperson) => (
                <option key={salesperson.id} value={salesperson.id}>
                  {salesperson.displayName}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button secondary"
            type="button"
            disabled={
              metadataMutation.isPending || ['Completed', 'Cancelled'].includes(project.status)
            }
            title={
              ['Completed', 'Cancelled'].includes(project.status)
                ? 'Reopen the project before editing its details.'
                : 'Edit project details'
            }
            onClick={() => {
              setMetadataDraft(metadataDraftFromProject(project));
              setMetadataEditing(true);
            }}
          >
            <Pencil /> Edit Project
          </button>
          <button
            className="button secondary"
            type="button"
            disabled={
              referenceMutation.isPending ||
              ['Completed', 'Cancelled'].includes(project.status) ||
              !canChangeProjectReference(currentUser, project)
            }
            title={
              canChangeProjectReference(currentUser, project)
                ? 'Change the visible project reference. The managed folder will be renamed to match.'
                : 'You cannot change this project reference.'
            }
            onClick={() => {
              setProposedReference(project.projectCode);
              setReferenceDialogOpen(true);
            }}
          >
            <Settings2 /> Change Reference
          </button>
          <button
            className="button secondary"
            type="button"
            disabled={
              exportMutation.isPending || !workspace.luminaires.length || !workspace.folderPath
            }
            title={
              workspace.folderPath
                ? 'Generate Schedule and BOQ'
                : 'Connect the project folder first'
            }
            onClick={() => exportMutation.mutate()}
          >
            {exportMutation.isPending ? <LoaderCircle className="spin" /> : <FileSpreadsheet />}{' '}
            Generate Schedule & BOQ
          </button>
          <button
            className="button primary"
            type="button"
            onClick={() => navigate(`/projects/${id}/packages`)}
          >
            <PackageCheck /> Build Revision Package
          </button>
          {project.status === 'Archived' ? (
            <>
              <button
                className="button secondary"
                type="button"
                disabled={restoreMutation.isPending}
                onClick={() => restoreMutation.mutate()}
              >
                <RotateCcw /> Restore Project
              </button>
              <button
                className="button ghost ghost-danger"
                type="button"
                disabled={removeProjectMutation.isPending}
                onClick={() => {
                  const confirmation = window.prompt(
                    `Remove this project from SCT Workspace only?\n\nThe physical folder will NOT be deleted.\n\nType the exact project code:\n${project.projectCode}`,
                  );
                  if (confirmation !== null) removeProjectMutation.mutate(confirmation.trim());
                }}
              >
                <Trash2 /> Remove from App
              </button>
            </>
          ) : (
            <button
              className="button ghost"
              type="button"
              disabled={archiveMutation.isPending}
              onClick={() => {
                if (
                  window.confirm('Archive this project? Its folder and files will stay untouched.')
                )
                  archiveMutation.mutate();
              }}
            >
              <Archive /> Archive Project
            </button>
          )}
        </div>
      </header>

      {!isPlaceholderSection ? (
        <>
          {viewMode === 'summary' ? (
            <ProjectSummary
              project={project}
              workspace={workspace}
              cycles={workflowHistoryQuery.data?.revisionCycles ?? []}
              activity={workspace.activity}
            />
          ) : null}

          {viewMode === 'workflow' ? (
            <div className="operations-main-stack">
              <ProjectContextHeaderView header={projectContextHeader(project)} />
              <ProjectTimeline
                projectId={project.id}
                transitions={workflowHistoryQuery.data?.transitions ?? []}
                revisionCycles={workflowHistoryQuery.data?.revisionCycles ?? []}
                revisions={workspace.revisions}
                meetings={workspace.meetings}
                actions={workspace.actions}
                exports={workspace.exports}
              />
            </div>
          ) : null}

          {tab === 'overview' && viewMode === 'overview' ? (
            <div className="operations-main-stack">
              <ProjectSummary
                project={project}
                workspace={workspace}
                cycles={workflowHistoryQuery.data?.revisionCycles ?? []}
                activity={workspace.activity}
              />
              <ProjectHealthPanel workspace={workspace} />
              <div className="project-overview-grid">
                <section className="content-card">
                  <h2>Project brief</h2>
                  {['Completed', 'Cancelled'].includes(project.status) ? (
                    <p className="muted-copy" role="status">
                      This project is {personalStatusLabel(project.status).toLowerCase()}. Reopen it
                      before editing its details.
                    </p>
                  ) : null}
                  <dl className="detail-list">
                    <div>
                      <dt>Project type</dt>
                      <dd>{project.projectType}</dd>
                    </div>
                    <div>
                      <dt>Luminaire input</dt>
                      <dd>{luminaireInputModeLabel(project.luminaireInputMode)}</dd>
                    </div>
                    <div>
                      <dt>Design stage</dt>
                      <dd>{project.designStage}</dd>
                    </div>
                    <div>
                      <dt>CRM Reference</dt>
                      <dd>{project.crmReference || 'Not Set'}</dd>
                    </div>
                    <div>
                      <dt>Commercial Value</dt>
                      <dd>
                        {formatCommercialValue(
                          project.commercialValueMinor,
                          project.commercialCurrency,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Drawing reference</dt>
                      <dd>{project.drawingReference || '—'}</dd>
                    </div>
                    <div>
                      <dt>Estimated hours</dt>
                      <dd>
                        {project.actualHours}h / {project.estimatedHours}h
                      </dd>
                    </div>
                  </dl>
                  <h3>Lighting scope</h3>
                  <p className="muted-copy">{project.lightingScope}</p>
                  {project.luxRequirements ? (
                    <>
                      <h3>Lux requirements</h3>
                      <p className="muted-copy">{project.luxRequirements}</p>
                    </>
                  ) : null}
                </section>
                <aside className="content-card">
                  <h2>Workspace</h2>
                  <div className="workspace-path">
                    <FolderOpen />
                    <div>
                      <strong>
                        {workspace.folderPath ? 'Project folder created' : 'Folder not created yet'}
                      </strong>
                      <span title={workspace.folderPath || undefined}>
                        {workspace.folderPath ??
                          'Set a projects root in Settings, then create the folder.'}
                      </span>
                    </div>
                    {workspace.folderPath ? (
                      <div className="row-actions">
                        <button
                          className="icon-button"
                          type="button"
                          title="Open folder"
                          onClick={() => {
                            if (desktop.available()) void desktop.openPath(workspace.folderPath!);
                            else void navigator.clipboard.writeText(workspace.folderPath!);
                          }}
                        >
                          <FolderOpen size={16} />
                        </button>
                        <button
                          className="icon-button"
                          type="button"
                          title="Copy path"
                          onClick={() => {
                            void navigator.clipboard.writeText(workspace.folderPath!);
                            showToast('Folder path copied.');
                          }}
                        >
                          <Clipboard size={16} />
                        </button>
                      </div>
                    ) : (
                      <button
                        className="button secondary"
                        type="button"
                        disabled={folderMutation.isPending}
                        onClick={() => folderMutation.mutate()}
                      >
                        {folderMutation.isPending ? (
                          <LoaderCircle className="spin" />
                        ) : (
                          <FolderOpen size={16} />
                        )}{' '}
                        Create
                      </button>
                    )}
                  </div>
                  <dl className="detail-list">
                    <div>
                      <dt>Folder profile</dt>
                      <dd>{workspace.folderProfile}</dd>
                    </div>
                    <div>
                      <dt>Luminaire input</dt>
                      <dd>{luminaireInputModeLabel(workspace.lightingPackage.inputMode)}</dd>
                    </div>
                    <div>
                      <dt>Latest export</dt>
                      <dd>
                        {workspace.exports[0]
                          ? `Revision ${workspace.exports[0].revision}`
                          : 'Not exported'}
                      </dd>
                    </div>
                  </dl>
                  <h3>Project scope</h3>
                  <div className="scope-chips">
                    {((workspace as WorkspaceWithScope).scopeItems ?? []).map((item) => (
                      <span key={item.id}>{item.label}</span>
                    ))}
                  </div>
                </aside>
              </div>
              <ActivityModule workspace={workspace} />
              <ProjectTimeline
                projectId={project.id}
                transitions={workflowHistoryQuery.data?.transitions ?? []}
                revisionCycles={workflowHistoryQuery.data?.revisionCycles ?? []}
                revisions={workspace.revisions}
                meetings={workspace.meetings}
                actions={workspace.actions}
                exports={workspace.exports}
              />
              <WorkSessionHistory projectId={project.id} />
            </div>
          ) : null}

          {tab === 'information' ? (
            <InformationModule project={project} workspace={workspace} invalidate={invalidate} />
          ) : null}

          {tab === 'intelligence' ? (
            <LocalIntelligenceCenter project={project} workspace={workspace} />
          ) : null}

          {tab === 'scope' ? (
            <ScopeAndServices
              projectId={project.id}
              project={project}
              workspace={workspace as WorkspaceWithScope}
              invalidate={invalidate}
            />
          ) : null}

          {tab === 'workspace' ? (
            <WorkspaceSetupCenter
              projectId={project.id}
              project={project}
              workspace={workspace}
              invalidate={invalidate}
            />
          ) : null}

          {tab === 'actions' ? (
            <ActionsModule project={project} workspace={workspace} invalidate={invalidate} />
          ) : null}

          {tab === 'meetings' ? (
            <MeetingsModule project={project} workspace={workspace} invalidate={invalidate} />
          ) : null}

          {tab === 'reviews' ? (
            <ReviewsModule project={project} workspace={workspace} invalidate={invalidate} />
          ) : null}

          {tab === 'contacts' ? (
            <ContactsModule project={project} workspace={workspace} invalidate={invalidate} />
          ) : null}

          {tab === 'revisions' ? (
            <RevisionsFilesModule project={project} workspace={workspace} invalidate={invalidate} />
          ) : null}

          {tab === 'package' ? (
            <RevisionPackageBuilder
              projectId={project.id}
              records={workspace.revisionPackages}
              invalidate={invalidate}
            />
          ) : null}

          {tab === 'deliverables' ? (
            <section className="deliverable-grid">
              {workspace.deliverables.map((deliverable) => (
                <article className="deliverable-card" key={deliverable.id}>
                  <div className="deliverable-head">
                    <span>{String(deliverable.sortOrder + 1).padStart(2, '0')}</span>
                    <div>
                      <h3>{deliverable.title}</h3>
                      <small>Due {formatDate(deliverable.dueDate)}</small>
                    </div>
                  </div>
                  <ProgressBar value={deliverable.progressPercent} />
                  <div className="deliverable-controls">
                    <select
                      aria-label={`Status for ${deliverable.title}`}
                      value={deliverable.status}
                      onChange={(event) =>
                        deliverableMutation.mutate({
                          deliverableId: deliverable.id,
                          status: event.target.value as DeliverableStatus,
                          progressPercent:
                            event.target.value === 'Completed' ? 100 : deliverable.progressPercent,
                        })
                      }
                    >
                      {Object.entries(deliverableStatusLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <label>
                      <span>Progress</span>
                      <input
                        aria-label={`Progress for ${deliverable.title}`}
                        type="number"
                        min="0"
                        max="100"
                        value={deliverable.progressPercent}
                        onChange={(event) =>
                          deliverableMutation.mutate({
                            deliverableId: deliverable.id,
                            status: deliverable.status,
                            progressPercent: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                  </div>
                </article>
              ))}
            </section>
          ) : null}

          {tab === 'luminaires' ? (
            <section className="content-card luminaire-studio-card">
              <div className="section-toolbar">
                <div>
                  <span className="eyebrow">Integrated luminaire studio</span>
                  <h2>Luminaire Schedule</h2>
                  <p>
                    Manual entry or import from AutoCAD / DIALux. Technical data remains
                    project-specific.
                  </p>
                </div>
                <div className="toolbar-actions">
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => setImportSource('AutoCadCsv')}
                  >
                    <Import size={16} /> AutoCAD CSV
                  </button>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => setImportSource('DialuxCsv')}
                  >
                    <Import size={16} /> DIALux CSV
                  </button>
                  <button
                    className="button primary"
                    type="button"
                    onClick={() => {
                      setLuminaire(emptyLuminaire);
                      setEditor('new');
                    }}
                  >
                    <Plus size={16} /> Add Luminaire
                  </button>
                </div>
              </div>
              {workspace.luminaires.length ? (
                <div className="table-scroll">
                  <table className="luminaire-table">
                    <thead>
                      <tr>
                        {visibleSchedule.map((column) => (
                          <th key={column.fieldKey}>{column.header}</th>
                        ))}
                        <th aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {workspace.luminaires.map((record) => (
                        <tr key={record.id}>
                          {visibleSchedule.map((column) => {
                            const value =
                              column.fieldKey === 'imagePath'
                                ? record.imagePath
                                  ? 'Image linked'
                                  : ''
                                : displayValue(record, column.fieldKey);
                            return (
                              <td key={column.fieldKey} title={value || undefined}>
                                {column.fieldKey === 'imagePath' && record.imagePath ? (
                                  <span className="path-value">Image linked</span>
                                ) : (
                                  value || '—'
                                )}
                              </td>
                            );
                          })}
                          <td>
                            <div className="row-actions">
                              <button
                                className="icon-button"
                                type="button"
                                title="Edit"
                                onClick={() => {
                                  setLuminaire(recordInput(record));
                                  setEditor(record);
                                }}
                              >
                                <Pencil size={15} />
                              </button>
                              <button
                                className="icon-button danger-text"
                                type="button"
                                title="Delete"
                                onClick={() => {
                                  if (window.confirm(`Delete ${record.tag}?`))
                                    deleteMutation.mutate(record.id);
                                }}
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState
                  title="No luminaires yet"
                  description="Add fixtures manually or import a luminaire CSV from AutoCAD or DIALux."
                  action={
                    <button
                      className="button primary"
                      type="button"
                      onClick={() => {
                        setLuminaire(emptyLuminaire);
                        setEditor('new');
                      }}
                    >
                      <Plus size={16} /> Add first luminaire
                    </button>
                  }
                />
              )}
            </section>
          ) : null}

          {tab === 'outputs' ? (
            <section className="output-setup-layout">
              <div className="content-card paper-size-card">
                <div>
                  <span className="eyebrow">PDF layout</span>
                  <h2>Paper size</h2>
                  <p>Auto uses A3 landscape for wide schedules and A4 for compact tables.</p>
                </div>
                <div className="paper-size-options" role="group" aria-label="PDF paper size">
                  {(['Auto', 'A4', 'A3'] as PdfPaperSize[]).map((size) => (
                    <button
                      type="button"
                      key={size}
                      className={pdfPaperSize === size ? 'active' : ''}
                      onClick={() => setPdfPaperSize(size)}
                    >
                      <strong>{size}</strong>
                      <span>{size === 'Auto' ? 'Recommended' : `${size} landscape`}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="content-card">
                <div className="section-toolbar">
                  <div>
                    <span className="eyebrow">Client-facing spreadsheet</span>
                    <h2>Luminaire Schedule columns</h2>
                    <p>Choose exactly what appears and rename each heading.</p>
                  </div>
                  <LayoutList />
                </div>
                <ColumnEditor columns={scheduleColumns} onChange={setScheduleColumns} />
              </div>
              <div className="content-card">
                <div className="section-toolbar">
                  <div>
                    <span className="eyebrow">Technical quantities</span>
                    <h2>Technical BOQ columns</h2>
                    <p>Quantities support No., m, m², sets or any project unit.</p>
                  </div>
                  <FileSpreadsheet />
                </div>
                <ColumnEditor columns={boqColumns} onChange={setBoqColumns} />
              </div>
              <footer className="output-save-bar">
                <span>
                  <Settings2 /> Column visibility and paper size apply to future exports.
                </span>
                <button
                  className="button primary"
                  type="button"
                  disabled={
                    columnsMutation.isPending ||
                    !scheduleColumns.some((column) => column.visible) ||
                    !boqColumns.some((column) => column.visible)
                  }
                  onClick={() => columnsMutation.mutate()}
                >
                  {columnsMutation.isPending ? <LoaderCircle className="spin" /> : <Save />} Save
                  Output Setup
                </button>
              </footer>
            </section>
          ) : null}

          {tab === 'assets' ? (
            <LuminaireAssetsCenter
              projectId={project.id}
              luminaires={workspace.luminaires}
              invalidate={invalidate}
            />
          ) : null}

          {tab === 'exports' ? (
            <section className="content-card">
              <div className="section-toolbar">
                <div>
                  <span className="eyebrow">Controlled deliverables</span>
                  <h2>Excel, PDF & datasheets</h2>
                  <p>
                    Each export creates a new revision folder. Existing files are never overwritten.
                  </p>
                </div>
                <button
                  className="button primary"
                  type="button"
                  disabled={
                    exportMutation.isPending ||
                    !workspace.luminaires.length ||
                    !workspace.folderPath
                  }
                  title={
                    workspace.folderPath
                      ? 'Export a new revision'
                      : 'Connect the project folder first'
                  }
                  onClick={() => exportMutation.mutate()}
                >
                  <FileDown size={16} /> Export New Revision
                </button>
              </div>
              {workspace.exports.length ? (
                <div className="revision-list">
                  {workspace.exports.map((record) => (
                    <article key={record.id}>
                      <span className="revision-number">
                        R{String(record.revision).padStart(2, '0')}
                      </span>
                      <div>
                        <strong>Lighting package revision {record.revision}</strong>
                        <small>
                          {formatDate(record.createdAt, { hour: '2-digit', minute: '2-digit' })}
                        </small>
                      </div>
                      <div className="revision-files">
                        {[
                          ['Schedule Excel', record.scheduleExcelPath, <FileSpreadsheet />],
                          ['Schedule PDF', record.schedulePdfPath, <FileDown />],
                          ['BOQ Excel', record.boqExcelPath, <FileSpreadsheet />],
                          ['BOQ PDF', record.boqPdfPath, <FileDown />],
                        ].map(([label, filePath, icon]) => (
                          <button
                            className="file-path-button"
                            type="button"
                            key={String(label)}
                            title={`${String(label)} · ${String(filePath)}`}
                            onClick={() => {
                              if (desktop.available()) void desktop.openPath(String(filePath));
                              else void navigator.clipboard.writeText(String(filePath));
                            }}
                          >
                            {icon}
                            <span>
                              <strong>{label}</strong>
                              <small>{filePath}</small>
                            </span>
                          </button>
                        ))}
                      </div>
                      <button
                        className="icon-button"
                        type="button"
                        title="Open datasheet folder"
                        onClick={() => {
                          if (desktop.available()) void desktop.openPath(record.datasheetFolder);
                          else void navigator.clipboard.writeText(record.datasheetFolder);
                        }}
                      >
                        <Download size={16} />
                      </button>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="No exported revisions"
                  description="Add luminaires, confirm the output columns, then export Excel, PDF and the datasheets package together."
                />
              )}
            </section>
          ) : null}
        </>
      ) : null}

      {section && PROJECT_PLACEHOLDER_TITLES[section] ? (
        <StructuralPlaceholder
          title={PROJECT_PLACEHOLDER_TITLES[section].title}
          detail={PROJECT_PLACEHOLDER_TITLES[section].detail}
        />
      ) : null}

      {metadataEditing && metadataDraft ? (
        <MetadataEditor
          project={project}
          draft={metadataDraft}
          projectTypes={projectTypesQuery.data}
          projectTypesLoading={projectTypesQuery.isLoading}
          projectTypesError={projectTypesQuery.isError}
          onChange={setMetadataDraft}
          saving={metadataMutation.isPending}
          onClose={() => {
            setMetadataEditing(false);
            setMetadataDraft(null);
          }}
          onSave={() => metadataMutation.mutate(metadataDraft)}
        />
      ) : null}
      {referenceDialogOpen && project ? (
        <ProjectReferenceEditor
          project={project}
          workspace={workspace}
          draft={proposedReference}
          onChange={setProposedReference}
          saving={referenceMutation.isPending}
          onClose={() => {
            setReferenceDialogOpen(false);
            setProposedReference('');
          }}
          onSave={() => referenceMutation.mutate(proposedReference)}
        />
      ) : null}
      {editor ? (
        <LuminaireEditor
          value={luminaire}
          onChange={setLuminaire}
          title={editor === 'new' ? 'Add luminaire' : `Edit ${editor.tag}`}
          saving={luminaireMutation.isPending}
          onClose={() => setEditor(null)}
          onSave={() => luminaireMutation.mutate()}
        />
      ) : null}
      {importSource ? (
        <LuminaireImportCenter
          projectId={project.id}
          initialSource={importSource}
          invalidate={invalidate}
          onClose={() => setImportSource(null)}
        />
      ) : null}
    </>
  );
}

type WorkflowActionKind = 'hold' | 'complete' | 'reopen' | 'cancel' | 'transition' | 'feedback';

interface WorkflowAction {
  label: string;
  target: ProjectStatus;
  kind: WorkflowActionKind;
  confirm: boolean;
}

interface PrimaryAction {
  label: string;
  target: ProjectStatus;
  confirm: boolean;
}

function primaryAction(project: Project): PrimaryAction | null {
  switch (project.status) {
    case 'Planning':
      return { label: 'Start Work', target: 'InProgress', confirm: false };
    case 'InProgress':
      return { label: 'Move to Client Review', target: 'ClientReview', confirm: false };
    case 'ClientReview':
      return { label: 'Client Requested Changes', target: 'RevisionRequired', confirm: false };
    case 'RevisionRequired':
      return { label: 'Start Revision Work', target: 'InProgress', confirm: false };
    case 'OnHold':
      return {
        label: 'Resume',
        target: project.statusBeforeHold ?? 'InProgress',
        confirm: false,
      };
    case 'Completed':
      return { label: 'Reopen Project', target: 'InProgress', confirm: true };
    case 'Cancelled':
      return { label: 'Reopen Project', target: 'InProgress', confirm: true };
    default:
      return null;
  }
}

function secondaryActions(project: Project): WorkflowAction[] {
  const allowed = getAllowedPersonalTransitions(project);
  const primary = primaryAction(project);
  const actions: WorkflowAction[] = [];
  const add = (target: ProjectStatus, label: string, kind: WorkflowActionKind) => {
    if (allowed.includes(target) && target !== primary?.target) {
      actions.push({ label, target, kind, confirm: kind !== 'transition' });
    }
  };
  switch (project.status) {
    case 'Planning':
      add('OnHold', 'Put On Hold', 'hold');
      add('Cancelled', 'Cancel Project', 'cancel');
      break;
    case 'InProgress':
      add('OnHold', 'Put On Hold', 'hold');
      add('Completed', 'Complete Project', 'complete');
      add('Cancelled', 'Cancel Project', 'cancel');
      break;
    case 'ClientReview':
      add('OnHold', 'Put On Hold', 'hold');
      add('Completed', 'Complete Project', 'complete');
      add('Cancelled', 'Cancel Project', 'cancel');
      break;
    case 'RevisionRequired':
      add('OnHold', 'Put On Hold', 'hold');
      add('Cancelled', 'Cancel Project', 'cancel');
      break;
    case 'OnHold':
      add('Cancelled', 'Cancel Project', 'cancel');
      break;
    case 'Completed':
    case 'Cancelled':
      // Primary Reopen only; no safe secondary actions.
      break;
    default:
      // Legacy Personal-compatible statuses: expose valid controlled transitions
      // in a compact Change Status control, never an unrestricted dropdown.
      for (const target of allowed) {
        if (target === project.status) continue;
        actions.push({
          label: personalStatusLabel(target),
          target,
          kind: 'transition',
          confirm: false,
        });
      }
  }
  return actions;
}

function pausedFromLabel(project: Project): string | null {
  if (project.status !== 'OnHold' || !project.statusBeforeHold) return null;
  return `Paused from ${personalStatusLabel(project.statusBeforeHold)}`;
}

function PersonalWorkflowControl({
  project,
  pending,
  onTransition,
}: {
  project: Project;
  pending: boolean;
  onTransition: (target: ProjectStatus, reason?: string) => void;
}) {
  const primary = primaryAction(project);
  const secondary = secondaryActions(project);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirm, setConfirm] = useState<WorkflowAction | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const description = personalStatusDescription(project.status);
  const pausedFrom = pausedFromLabel(project);

  // Close the confirmation dialog once the server confirms the transition by
  // returning the target status. On failure the status does not change, so the
  // dialog stays open and any entered cancellation reason is preserved.
  useEffect(() => {
    if (confirm && project.status === confirm.target) {
      setConfirm(null);
      setCancelReason('');
      setCancelError(null);
    }
  }, [project.status, confirm]);

  // Close the feedback dialog once the server confirms the transition to
  // RevisionRequired. On failure the status does not change, so the dialog stays
  // open and any entered feedback is preserved.
  useEffect(() => {
    if (feedbackOpen && project.status === 'RevisionRequired') {
      setFeedbackOpen(false);
      setFeedbackText('');
      setFeedbackError(null);
    }
  }, [project.status, feedbackOpen]);

  const runAction = (action: WorkflowAction) => {
    setMenuOpen(false);
    if (action.confirm) {
      setCancelReason('');
      setCancelError(null);
      setConfirm(action);
      return;
    }
    onTransition(action.target);
  };

  const runPrimary = () => {
    if (!primary) return;
    // Client Requested Changes requires a Feedback Summary before transitioning.
    if (primary.target === 'RevisionRequired' && project.status === 'ClientReview') {
      setFeedbackText('');
      setFeedbackError(null);
      setFeedbackOpen(true);
      return;
    }
    if (primary.confirm) {
      setCancelReason('');
      setCancelError(null);
      setConfirm({
        label: primary.label,
        target: primary.target,
        kind: primary.target === 'InProgress' ? 'reopen' : 'transition',
        confirm: true,
      });
      return;
    }
    onTransition(primary.target);
  };

  const feedbackSubmit = () => {
    const trimmed = feedbackText.trim();
    if (!trimmed) {
      setFeedbackError('A feedback summary is required.');
      return;
    }
    onTransition('RevisionRequired', trimmed);
  };

  const confirmSubmit = () => {
    if (!confirm) return;
    if (confirm.kind === 'cancel') {
      const trimmed = cancelReason.trim();
      if (!trimmed) {
        setCancelError('A cancellation reason is required.');
        return;
      }
      onTransition(confirm.target, trimmed);
      return;
    }
    onTransition(confirm.target);
  };

  const pendingLabel = pending
    ? primary?.target === 'InProgress'
      ? 'Starting…'
      : primary?.target === 'ClientReview'
        ? 'Moving…'
        : primary?.target === 'RevisionRequired'
          ? 'Updating…'
          : primary?.target === 'Completed'
            ? 'Completing…'
            : 'Working…'
    : null;

  return (
    <div className="workflow-control">
      <div className="workflow-status">
        <span className="workflow-status-label">Current Status</span>
        <div className="workflow-status-row">
          <StatusBadge status={project.status} label={personalStatusLabel(project.status)} />
          {pausedFrom ? <span className="workflow-paused-hint">{pausedFrom}</span> : null}
        </div>
        {description ? <p className="workflow-description">{description}</p> : null}
      </div>
      <div className="workflow-actions">
        {primary ? (
          <button className="button primary" type="button" disabled={pending} onClick={runPrimary}>
            {pending ? <LoaderCircle className="spin" /> : <Play />} {pendingLabel ?? primary.label}
          </button>
        ) : null}
        {secondary.length ? (
          <div className="workflow-more">
            <button
              className="button secondary"
              type="button"
              disabled={pending}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              {primary ? (
                <>
                  <MoreHorizontal /> More Actions
                </>
              ) : (
                <>
                  <Settings2 /> Change Status
                </>
              )}
              <ChevronDown size={14} />
            </button>
            {menuOpen ? (
              <>
                <button
                  className="workflow-menu-backdrop"
                  type="button"
                  aria-label="Close workflow menu"
                  onClick={() => setMenuOpen(false)}
                />
                <div className="workflow-menu" role="menu">
                  {secondary.map((action) => (
                    <button
                      key={action.target}
                      type="button"
                      role="menuitem"
                      disabled={pending}
                      onClick={() => runAction(action)}
                    >
                      {action.kind === 'cancel' ? <Ban /> : null}
                      {action.kind === 'hold' ? <Pause /> : null}
                      {action.kind === 'complete' ? <CircleCheck /> : null}
                      {action.kind === 'reopen' ? <Undo2 /> : null}
                      {action.label}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {feedbackOpen ? (
        <div className="operation-modal-backdrop" role="presentation">
          <section
            className="operation-modal workflow-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Client requested changes"
          >
            <div className="modal-heading">
              <div>
                <span>Workflow</span>
                <h2>Client Requested Changes</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close feedback dialog"
                onClick={() => {
                  setFeedbackOpen(false);
                  setFeedbackText('');
                  setFeedbackError(null);
                }}
              >
                <X />
              </button>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                feedbackSubmit();
              }}
            >
              <label className="field field-wide">
                Feedback Summary<span className="required">Required</span>
                <textarea
                  value={feedbackText}
                  onChange={(event) => {
                    setFeedbackText(event.target.value);
                    if (feedbackError) setFeedbackError(null);
                  }}
                  placeholder="Briefly capture the client's requested changes."
                  aria-label="Feedback summary"
                  maxLength={500}
                />
                {feedbackError ? <small className="field-error">{feedbackError}</small> : null}
              </label>
              <div className="workflow-confirm-actions">
                <button
                  className="button ghost"
                  type="button"
                  onClick={() => {
                    setFeedbackOpen(false);
                    setFeedbackText('');
                    setFeedbackError(null);
                  }}
                >
                  Keep in Client Review
                </button>
                <button className="button primary" type="submit" disabled={pending}>
                  {pending ? <LoaderCircle className="spin" /> : <Check />} Confirm Changes
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {confirm ? (
        <div className="operation-modal-backdrop" role="presentation">
          <section
            className="operation-modal workflow-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-label={confirm.kind === 'cancel' ? 'Cancel project' : confirm.label}
          >
            <div className="modal-heading">
              <div>
                <span>Workflow</span>
                <h2>{confirm.kind === 'cancel' ? 'Cancel Project' : confirm.label}</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close workflow dialog"
                onClick={() => {
                  setConfirm(null);
                  setCancelReason('');
                  setCancelError(null);
                }}
              >
                <X />
              </button>
            </div>
            {confirm.kind === 'cancel' ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  confirmSubmit();
                }}
              >
                <label className="field field-wide">
                  Reason<span className="required">Required</span>
                  <textarea
                    value={cancelReason}
                    onChange={(event) => {
                      setCancelReason(event.target.value);
                      if (cancelError) setCancelError(null);
                    }}
                    placeholder="Explain why this project is being cancelled."
                    aria-label="Cancellation reason"
                    maxLength={500}
                  />
                  {cancelError ? <small className="field-error">{cancelError}</small> : null}
                </label>
                <div className="workflow-confirm-actions">
                  <button
                    className="button ghost"
                    type="button"
                    onClick={() => {
                      setConfirm(null);
                      setCancelReason('');
                      setCancelError(null);
                    }}
                  >
                    Keep Project
                  </button>
                  <button className="button danger" type="submit" disabled={pending}>
                    {pending ? <LoaderCircle className="spin" /> : <Ban />} Cancel Project
                  </button>
                </div>
              </form>
            ) : (
              <div className="workflow-confirm-actions">
                <button className="button ghost" type="button" onClick={() => setConfirm(null)}>
                  Keep Project
                </button>
                <button
                  className="button primary"
                  type="button"
                  disabled={pending}
                  onClick={confirmSubmit}
                >
                  {pending ? <LoaderCircle className="spin" /> : <Check />} {confirm.label}
                </button>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}

type WorkspaceWithScope = ProjectWorkspace & { scopeItems: ProjectScopeItem[] };

function WorkspaceSetupCenter({
  projectId,
  project,
  workspace,
  invalidate,
}: {
  projectId: string;
  project: Project;
  workspace: ProjectWorkspace;
  invalidate: () => Promise<void>;
}) {
  const { showToast } = useToast();
  const profilesQuery = useQuery({ queryKey: ['folder-profiles'], queryFn: api.folderProfiles });
  const workspaceWithScope = workspace as WorkspaceWithScope;
  const [editingScope, setEditingScope] = useState(false);
  const [draftServices, setDraftServices] = useState<ProjectServiceCode[]>(workspace.services);
  const [draftCustomItems, setDraftCustomItems] = useState<ProjectScopeItem[]>(
    workspaceWithScope.scopeItems?.filter((item) => item.custom) ?? [],
  );
  const [customScopeInput, setCustomScopeInput] = useState('');
  const [folderProfile, setFolderProfile] = useState(workspace.folderProfile);
  const [folders, setFolders] = useState<FolderNodePreset[]>(workspace.folderStructure);
  const [outputFolders, setOutputFolders] = useState<ProjectOutputFolders>(workspace.outputFolders);
  const [folderPath, setFolderPath] = useState(workspace.folderPath ?? '');
  const [ensureFolders, setEnsureFolders] = useState(Boolean(workspace.folderPath));
  const [manageStructureOpen, setManageStructureOpen] = useState(false);
  const [profileToApply, setProfileToApply] = useState(workspace.folderProfile);

  useEffect(() => {
    setDraftServices(workspace.services);
    setDraftCustomItems(workspaceWithScope.scopeItems?.filter((item) => item.custom) ?? []);
    setFolderProfile(workspace.folderProfile);
    setFolders(workspace.folderStructure);
    setOutputFolders(workspace.outputFolders);
    setFolderPath(workspace.folderPath ?? '');
  }, [workspace, workspaceWithScope]);

  const saveProfile = useMutation({
    mutationFn: ({ name, description }: { name: string; description: string }) =>
      api.saveFolderProfile({ name, description, folders, outputFolders }),
    onSuccess: async (profile) => {
      await profilesQuery.refetch();
      setFolderProfile(profile.name);
      setProfileToApply(profile.name);
      showToast(`Folder profile “${profile.name}” saved.`);
    },
    onError: (error) => showToast((error as Error).message, 'error'),
  });
  const saveScope = useMutation({
    mutationFn: () =>
      apiRequest<{ workspace: ProjectWorkspace }>(`/api/projects/${projectId}/scope`, {
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
    onError: (error) => showToast((error as Error).message, 'error'),
  });
  const saveSetup = useMutation({
    mutationFn: () =>
      api.updateProjectWorkspaceSetup(projectId, {
        folderProfile,
        folderStructure: folders,
        outputFolders,
        ...(folderPath ? { connectFolderPath: folderPath } : {}),
        ensureFolders,
      }),
    onSuccess: async (result) => {
      await invalidate();
      showToast(
        result.createdFolderCount
          ? `Workspace updated and ${result.createdFolderCount} missing folder(s) created.`
          : 'Project folder setup updated.',
      );
    },
    onError: (error) => showToast((error as Error).message, 'error'),
  });
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
    setDraftServices(workspace.services);
    setDraftCustomItems(workspaceWithScope.scopeItems?.filter((item) => item.custom) ?? []);
    setCustomScopeInput('');
    setEditingScope(false);
  };
  const applyProfile = () => {
    const profile = profilesQuery.data?.find((item) => item.name === profileToApply);
    if (!profile) return;
    setFolderProfile(profile.name);
    setFolders(structuredClone(profile.folders));
    setOutputFolders(structuredClone(profile.outputFolders));
  };
  return (
    <div className="operations-main-stack workspace-setup-center">
      <section className="content-card">
        <div className="section-toolbar">
          <div>
            <span className="eyebrow">Editable project scope</span>
            <h2>Project scope</h2>
            <p>
              Choose the services that apply to this project, or add project-specific scope items.
              Nothing is forced.
            </p>
          </div>
          {!editingScope ? (
            <button
              className="button secondary"
              type="button"
              disabled={['Completed', 'Cancelled'].includes(project.status)}
              onClick={() => setEditingScope(true)}
            >
              <Pencil size={16} /> Edit Scope
            </button>
          ) : null}
        </div>
        {editingScope ? (
          <div className="scope-editor">
            <div className="workspace-service-grid">
              {projectServiceCodes.map((service) => {
                const selected = draftServices.includes(service);
                return (
                  <label className={selected ? 'selected' : ''} key={service}>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={(event) =>
                        setDraftServices((current) =>
                          event.target.checked
                            ? [...current, service]
                            : current.filter((item) => item !== service),
                        )
                      }
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
                    onChange={(event) => setCustomScopeInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        addCustomScopeItem();
                      }
                    }}
                    placeholder="e.g. Authority Submission"
                  />
                  <button className="button secondary" type="button" onClick={addCustomScopeItem}>
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
                        onClick={() => removeCustomScopeItem(item.id)}
                      >
                        <X size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div className="scope-editor-actions">
              <button className="button ghost" type="button" onClick={cancelScopeEdit}>
                Cancel
              </button>
              <button
                className="button primary"
                type="button"
                disabled={saveScope.isPending}
                onClick={() => saveScope.mutate()}
              >
                {saveScope.isPending ? <LoaderCircle className="spin" /> : <Save />} Save Scope
              </button>
            </div>
          </div>
        ) : (
          <div className="scope-chips">
            {(workspaceWithScope.scopeItems ?? []).map((item) => (
              <span key={item.id}>{item.label}</span>
            ))}
          </div>
        )}
      </section>
      <section className="content-card">
        <div className="section-toolbar">
          <div>
            <span className="eyebrow">Non-destructive folder control</span>
            <h2>Project folders & output destinations</h2>
            <p>
              Changes create missing folders only. Existing folders and files are never deleted or
              moved.
            </p>
          </div>
          <button
            className="button secondary"
            type="button"
            disabled={saveSetup.isPending}
            onClick={() => setManageStructureOpen(true)}
          >
            Manage Structure
          </button>
        </div>
        <div className="workspace-folder-controls">
          <label className="field">
            Start from a saved profile
            <span className="field-path-control">
              <select
                value={profileToApply}
                onChange={(event) => setProfileToApply(event.target.value)}
              >
                {profilesQuery.data?.map((profile) => (
                  <option key={profile.name} value={profile.name}>
                    {profile.name}
                  </option>
                ))}
              </select>
              <button className="button secondary" type="button" onClick={applyProfile}>
                Apply profile
              </button>
            </span>
          </label>
          <label className="field">
            Linked project folder
            <span className="field-path-control">
              <input
                value={folderPath}
                onChange={(event) => setFolderPath(event.target.value)}
                placeholder="Choose an existing project folder"
              />
              <button
                className="button secondary"
                type="button"
                onClick={async () => {
                  const selected = await desktop.selectFolder();
                  if (selected) setFolderPath(selected);
                }}
              >
                Browse
              </button>
            </span>
          </label>
          <div className="workspace-ensure-folders">
            <input
              id="ensure-project-folders"
              type="checkbox"
              checked={ensureFolders}
              onChange={(event) => setEnsureFolders(event.target.checked)}
            />
            <span>
              <label htmlFor="ensure-project-folders">
                <strong>Create missing folders</strong>
              </label>
              <small>Never deletes, renames, or moves existing content.</small>
            </span>
          </div>
        </div>
        <FolderStructureEditor
          folders={folders}
          outputFolders={outputFolders}
          disabled={saveSetup.isPending}
          saving={saveProfile.isPending}
          onFoldersChange={setFolders}
          onOutputFoldersChange={setOutputFolders}
          onSaveProfile={(name, description) => saveProfile.mutate({ name, description })}
        />
      </section>
      <footer className="output-save-bar">
        <span>
          <Settings2 /> Folder profile, output mapping, and folder link are saved to this project
          only. Scope is saved separately.
        </span>
        <button
          className="button primary"
          type="button"
          disabled={saveSetup.isPending || !folders.length}
          onClick={() => saveSetup.mutate()}
        >
          {saveSetup.isPending ? <LoaderCircle className="spin" /> : <Save />} Save Folder Setup
        </button>
      </footer>
      {manageStructureOpen ? (
        <ManageStructureDrawer
          projectId={projectId}
          project={project}
          workspace={workspace as unknown as ManageStructureWorkspace}
          onClose={() => setManageStructureOpen(false)}
          onChanged={invalidate}
        />
      ) : null}
    </div>
  );
}

function LuminaireAssetsCenter({
  projectId,
  luminaires,
  invalidate,
}: {
  projectId: string;
  luminaires: LuminaireRecord[];
  invalidate: () => Promise<void>;
}) {
  const { showToast } = useToast();
  const updateAsset = useMutation({
    mutationFn: ({
      record,
      field,
      value,
    }: {
      record: LuminaireRecord;
      field: 'imagePath' | 'datasheetPath';
      value: string;
    }) => api.updateLuminaire(projectId, record.id, { ...recordInput(record), [field]: value }),
    onSuccess: async () => {
      await invalidate();
      showToast('Luminaire asset updated.');
    },
    onError: (error) => showToast((error as Error).message, 'error'),
  });
  const withDatasheet = luminaires.filter((item) => item.datasheetPath).length;
  const withImage = luminaires.filter((item) => item.imagePath).length;
  const openAsset = (value: string) => {
    if (/^https:\/\//i.test(value)) void desktop.openExternal(value);
    else void desktop.openPath(value);
  };
  const chooseAsset = async (record: LuminaireRecord, field: 'imagePath' | 'datasheetPath') => {
    const selected = await desktop.selectFile(
      field === 'imagePath'
        ? [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
        : [{ name: 'Datasheets', extensions: ['pdf'] }],
    );
    if (selected) updateAsset.mutate({ record, field, value: selected });
  };
  return (
    <section className="content-card luminaire-assets-center">
      <div className="section-toolbar">
        <div>
          <span className="eyebrow">Project-specific source center</span>
          <h2>Datasheets & product images</h2>
          <p>
            Link each selected luminaire to its official datasheet and image. Nothing is taken from
            a fixed brand library.
          </p>
        </div>
        <div className="asset-completeness">
          <span>
            <strong>{withDatasheet}</strong> / {luminaires.length} datasheets
          </span>
          <span>
            <strong>{withImage}</strong> / {luminaires.length} images
          </span>
        </div>
      </div>
      <div className="asset-center-list">
        {luminaires.map((record) => (
          <article className="asset-center-row" key={record.id}>
            <div className="asset-tag">
              <strong>{record.tag}</strong>
              <span>{record.manufacturer || record.category || 'Luminaire'}</span>
              <small>{record.model || 'Model not entered'}</small>
            </div>
            {(
              [
                ['imagePath', 'Product image', record.imagePath, 'Choose image'],
                ['datasheetPath', 'Official datasheet', record.datasheetPath, 'Choose PDF'],
              ] as const
            ).map(([field, label, value, emptyLabel]) => (
              <div className={`asset-slot ${value ? 'complete' : 'missing'}`} key={field}>
                <span>{label}</span>
                <strong>{value ? value.split(/[\\/]/).at(-1) : 'Not linked'}</strong>
                <div className="row-actions">
                  {value ? (
                    <button
                      className="button secondary"
                      type="button"
                      onClick={() => openAsset(value)}
                    >
                      <FolderOpen /> Open
                    </button>
                  ) : null}
                  <button
                    className="button ghost"
                    type="button"
                    disabled={updateAsset.isPending}
                    onClick={() => void chooseAsset(record, field)}
                  >
                    {value ? 'Replace' : emptyLabel}
                  </button>
                  {value ? (
                    <button
                      className="icon-button danger-text"
                      type="button"
                      title={`Clear ${label}`}
                      disabled={updateAsset.isPending}
                      onClick={() => updateAsset.mutate({ record, field, value: '' })}
                    >
                      <X />
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </article>
        ))}
        {!luminaires.length ? (
          <EmptyState
            title="No luminaires to document"
            description="Add or import the project luminaires first, then link their official product files here."
          />
        ) : null}
      </div>
    </section>
  );
}

function ColumnEditor({
  columns,
  onChange,
}: {
  columns: OutputColumn[];
  onChange: (columns: OutputColumn[]) => void;
}) {
  const update = (index: number, patch: Partial<OutputColumn>) =>
    onChange(
      columns.map((column, current) => (current === index ? { ...column, ...patch } : column)),
    );
  return (
    <div className="column-editor">
      {[...columns]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((column) => {
          const index = columns.findIndex((item) => item.fieldKey === column.fieldKey);
          return (
            <div key={column.fieldKey} className={column.visible ? 'visible' : ''}>
              <label className="column-toggle">
                <input
                  aria-label={`${column.visible ? 'Hide' : 'Show'} ${column.header || column.fieldKey} column`}
                  type="checkbox"
                  checked={column.visible}
                  onChange={(event) => update(index, { visible: event.target.checked })}
                />
                <span>{column.visible ? <Check size={14} /> : null}</span>
              </label>
              <code>{column.fieldKey}</code>
              <input
                aria-label={`${column.fieldKey} heading`}
                value={column.header}
                onChange={(event) => update(index, { header: event.target.value })}
              />
              <div className="column-advanced">
                <label title="Use this field when comparing revisions">
                  <input
                    type="checkbox"
                    checked={column.compareInRevision}
                    onChange={(event) => update(index, { compareInRevision: event.target.checked })}
                  />
                  Compare
                </label>
                <label title="Block final issue when this field is missing">
                  <input
                    type="checkbox"
                    checked={column.requiredForIssue}
                    onChange={(event) => update(index, { requiredForIssue: event.target.checked })}
                  />
                  Required
                </label>
                <label title="Keep this field out of client-facing exports">
                  <input
                    type="checkbox"
                    checked={column.internalOnly}
                    onChange={(event) => update(index, { internalOnly: event.target.checked })}
                  />
                  Internal
                </label>
                <label>
                  Width
                  <input
                    type="number"
                    min="60"
                    max="600"
                    value={column.width}
                    onChange={(event) => update(index, { width: Number(event.target.value) })}
                  />
                </label>
              </div>
            </div>
          );
        })}
    </div>
  );
}

function MetadataEditor({
  project,
  draft,
  projectTypes,
  projectTypesLoading,
  projectTypesError,
  onChange,
  saving,
  onClose,
  onSave,
}: {
  project: Project;
  draft: MetadataDraft;
  projectTypes: ProjectType[] | undefined;
  projectTypesLoading: boolean;
  projectTypesError: boolean;
  onChange: (draft: MetadataDraft) => void;
  saving: boolean;
  onClose: () => void;
  onSave: () => void;
}) {
  const { currentUser } = useAppContext();
  const update = <K extends keyof MetadataDraft>(key: K, value: MetadataDraft[K]) =>
    onChange({ ...draft, [key]: value });
  const canEdit = (field: keyof Project) => canEditProjectField(currentUser, project, field);
  const commercialValue = parseCommercialValueInput(
    draft.commercialValueAmount,
    draft.commercialCurrency,
  );
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="metadata-editor"
        role="dialog"
        aria-modal="true"
        aria-label="Edit project details"
      >
        <header>
          <div>
            <span className="eyebrow">Project details</span>
            <h2>Edit Project</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close project editor"
            onClick={onClose}
          >
            <X />
          </button>
        </header>
        <form
          className="editor-grid"
          onSubmit={(event) => {
            event.preventDefault();
            if (commercialValue.ok) onSave();
          }}
        >
          {canEdit('projectName') ? (
            <label className="field">
              Project Name<span className="required">Required</span>
              <input
                value={draft.projectName}
                onChange={(event) => update('projectName', event.target.value)}
                maxLength={120}
              />
            </label>
          ) : null}
          {canEdit('clientName') ? (
            <label className="field">
              Client Name<span className="required">Required</span>
              <input
                value={draft.clientName}
                onChange={(event) => update('clientName', event.target.value)}
                maxLength={120}
              />
            </label>
          ) : null}
          {canEdit('crmReference') ? (
            <label className="field">
              CRM Reference
              <input
                value={draft.crmReference}
                onChange={(event) => update('crmReference', event.target.value)}
                placeholder="e.g. CRM-48572"
                maxLength={200}
              />
              <small>Optional. Leave blank to clear the CRM link.</small>
            </label>
          ) : null}
          {canEdit('commercialValueMinor') && canEdit('commercialCurrency') ? (
            <CommercialValueFields
              amount={draft.commercialValueAmount}
              currency={draft.commercialCurrency}
              error={commercialValue.ok ? undefined : commercialValue.error}
              disabled={saving}
              onAmountChange={(value) => update('commercialValueAmount', value)}
              onCurrencyChange={(value) => update('commercialCurrency', value)}
              onClear={() =>
                onChange({
                  ...draft,
                  commercialValueAmount: '',
                  commercialCurrency: '',
                })
              }
            />
          ) : null}
          {canEdit('projectType') ? (
            <ProjectTypeSelect
              value={draft.projectType}
              catalogue={projectTypes}
              loading={projectTypesLoading}
              error={projectTypesError}
              disabled={saving}
              onChange={(value) => update('projectType', value)}
            />
          ) : null}
          {canEdit('siteLocation') ? (
            <label className="field">
              Site Location<span className="required">Required</span>
              <input
                value={draft.siteLocation}
                onChange={(event) => update('siteLocation', event.target.value)}
                maxLength={180}
              />
            </label>
          ) : null}
          {canEdit('designStage') ? (
            <label className="field">
              Design Stage
              <select
                value={draft.designStage}
                onChange={(event) => update('designStage', event.target.value as DesignStage)}
              >
                {designStages.map((stage) => (
                  <option key={stage} value={stage}>
                    {designStageLabels[stage]}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {canEdit('priority') ? (
            <label className="field">
              Priority
              <select
                value={draft.priority}
                onChange={(event) => update('priority', event.target.value as Priority)}
              >
                {priorities.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {canEdit('complexity') ? (
            <label className="field">
              Complexity
              <select
                value={draft.complexity}
                onChange={(event) => update('complexity', event.target.value as Complexity)}
              >
                {complexities.map((complexity) => (
                  <option key={complexity} value={complexity}>
                    {complexity}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {canEdit('requiredDeliveryDate') ? (
            <label className="field">
              Required Delivery Date
              <input
                type="date"
                value={draft.requiredDeliveryDate}
                onChange={(event) => update('requiredDeliveryDate', event.target.value)}
              />
            </label>
          ) : null}
          {canEdit('estimatedHours') ? (
            <label className="field">
              Estimated Hours
              <input
                type="number"
                min="0"
                max="10000"
                value={draft.estimatedHours}
                onChange={(event) => update('estimatedHours', Number(event.target.value))}
              />
            </label>
          ) : null}
          {canEdit('progressPercent') ? (
            <label className="field">
              Progress %
              <input
                type="number"
                min="0"
                max="100"
                value={draft.progressPercent}
                onChange={(event) => update('progressPercent', Number(event.target.value))}
              />
            </label>
          ) : null}
          {canEdit('description') ? (
            <label className="field field-wide">
              Description
              <textarea
                rows={3}
                value={draft.description}
                onChange={(event) => update('description', event.target.value)}
                maxLength={4000}
              />
            </label>
          ) : null}
          {canEdit('lightingScope') ? (
            <label className="field field-wide">
              Lighting Scope<span className="required">Required</span>
              <textarea
                rows={3}
                value={draft.lightingScope}
                onChange={(event) => update('lightingScope', event.target.value)}
                maxLength={500}
              />
            </label>
          ) : null}
          {canEdit('luxRequirements') ? (
            <label className="field field-wide">
              Lux Requirements
              <textarea
                rows={3}
                value={draft.luxRequirements}
                onChange={(event) => update('luxRequirements', event.target.value)}
                maxLength={1000}
              />
            </label>
          ) : null}
          {canEdit('drawingReference') ? (
            <label className="field field-wide">
              Drawing Reference
              <input
                value={draft.drawingReference}
                onChange={(event) => update('drawingReference', event.target.value)}
                maxLength={300}
              />
            </label>
          ) : null}
        </form>
        <footer>
          <button className="button ghost" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            type="button"
            disabled={
              saving ||
              !commercialValue.ok ||
              !draft.projectName.trim() ||
              !draft.clientName.trim() ||
              !draft.projectType.trim() ||
              !draft.siteLocation.trim() ||
              !draft.lightingScope.trim()
            }
            onClick={onSave}
          >
            {saving ? <LoaderCircle className="spin" /> : <Save />} Save Changes
          </button>
        </footer>
      </section>
    </div>
  );
}

function ProjectReferenceEditor({
  project,
  workspace,
  draft,
  onChange,
  saving,
  onClose,
  onSave,
}: {
  project: Project;
  workspace: ProjectWorkspace | null | undefined;
  draft: string;
  onChange: (value: string) => void;
  saving: boolean;
  onClose: () => void;
  onSave: () => void;
}) {
  const folderName = workspace?.folderPath
    ? workspace.folderPath
        .replace(/[\\/]+$/, '')
        .split(/[\\/]/)
        .pop()
    : null;
  const trimmed = draft.trim();
  const sameCode = trimmed.toUpperCase() === project.projectCode;
  const validShape = /^\d{3,4}_SCT\d{6}_[A-Z0-9_]+$/.test(trimmed.toUpperCase());
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="metadata-editor reference-editor"
        role="dialog"
        aria-modal="true"
        aria-label="Change project reference"
      >
        <header>
          <div>
            <span className="eyebrow">Project identity</span>
            <h2>Change Project Reference</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close reference editor"
            onClick={onClose}
          >
            <X />
          </button>
        </header>
        <form
          className="editor-grid"
          onSubmit={(event) => {
            event.preventDefault();
            onSave();
          }}
        >
          <label className="field field-wide">
            Current Reference
            <input value={project.projectCode} readOnly aria-label="Current project reference" />
            <small>Your project ID, CRM reference and all related records stay unchanged.</small>
          </label>
          <label className="field field-wide">
            Proposed Reference<span className="required">Required</span>
            <input
              value={draft}
              onChange={(event) => onChange(event.target.value)}
              maxLength={80}
              placeholder="NNN_SCTYYMMDD_PROJECT_NAME"
              aria-label="Proposed project reference"
            />
            <small>Use the current convention, for example 019_SCT251204_GEVI_SHARJAH.</small>
          </label>
          <div className="field field-wide reference-warning" role="note">
            {folderName ? (
              <>
                The managed project folder <strong>{folderName}</strong> will be renamed to match
                the new reference. This changes the folder name on disk and updates the project file
                index.
              </>
            ) : (
              <>
                No managed project folder is linked to this project, so no folder will be renamed.
              </>
            )}
          </div>
          <div className="field field-wide reference-warning">
            This action is recorded in the project history, and the old reference stays discoverable
            through workspace search.
          </div>
        </form>
        <footer>
          <button className="button ghost" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            type="button"
            disabled={saving || !trimmed || sameCode || !validShape}
            onClick={onSave}
          >
            {saving ? <LoaderCircle className="spin" /> : <Settings2 />} Change Reference
          </button>
        </footer>
      </section>
    </div>
  );
}

function LuminaireEditor({
  value,
  onChange,
  title,
  saving,
  onClose,
  onSave,
}: {
  value: LuminaireRecordInput;
  onChange: (value: LuminaireRecordInput) => void;
  title: string;
  saving: boolean;
  onClose: () => void;
  onSave: () => void;
}) {
  // Quantity is kept as a local text string so the field can be temporarily
  // empty while the user is editing (Ctrl+A replace, backspace/delete, typing
  // multiple digits). Coercing an empty value to a number on every keystroke
  // (Number('') === 0) would force the controlled input back to 0 and block
  // natural keyboard entry. Valid numbers are pushed to the parent draft so
  // the saved record always carries the current numeric quantity.
  const [quantityText, setQuantityText] = useState(String(value.quantity));
  const update = (key: keyof LuminaireRecordInput, next: string | number) =>
    onChange({ ...value, [key]: next });
  const handleQuantityChange = (raw: string) => {
    setQuantityText(raw);
    if (raw.trim() === '') return;
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) update('quantity', parsed);
  };
  const fields: Array<[keyof LuminaireRecordInput, string, string]> = [
    ['tag', 'Type / Tag', 'DL01'],
    ['category', 'Category', 'Downlight'],
    ['description', 'Description', 'Recessed adjustable downlight'],
    ['manufacturer', 'Manufacturer', 'Project-specific brand'],
    ['model', 'Model', 'Model number'],
    ['wattage', 'Wattage', '10W'],
    ['lumens', 'Lumens', '900 lm'],
    ['lightColor', 'CCT / Light Colour', '3000K'],
    ['cri', 'CRI', 'CRI 90'],
    ['beamAngle', 'Beam Angle', '24°'],
    ['ipRating', 'IP Rating', 'IP44'],
    ['mounting', 'Mounting', 'Recessed'],
    ['cutout', 'Cut-out', 'Ø75 mm'],
    ['dimensions', 'Dimensions', 'Ø85 × 95 mm'],
    ['bodyColorFinish', 'Body Colour / Finish', 'Black'],
    ['driver', 'Driver', 'Remote driver'],
    ['control', 'Dimming / Control', 'DALI'],
    ['emergency', 'Emergency', 'No'],
    ['location', 'Location / Level', 'Ground floor'],
    ['unit', 'Unit', 'No. / m / set'],
    ['sourceName', 'Source Name', 'DIALux luminaire name'],
    ['imagePath', 'Image Path', 'Local image path'],
    ['datasheetPath', 'Datasheet Path or URL', 'Official PDF path or website URL'],
  ];
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="luminaire-editor" role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <div>
            <span className="eyebrow">Project luminaire</span>
            <h2>{title}</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close luminaire editor"
            onClick={onClose}
          >
            <X />
          </button>
        </header>
        <div className="editor-grid">
          {fields.map(([key, label, placeholder]) => (
            <label
              className={`field${key === 'description' || key === 'datasheetPath' || key === 'imagePath' ? ' field-wide' : ''}`}
              key={key}
            >
              {label}
              {key === 'tag' ? <span className="required">Required</span> : null}
              <span
                className={
                  key === 'datasheetPath' || key === 'imagePath' ? 'field-path-control' : undefined
                }
              >
                <input
                  value={String(value[key])}
                  onChange={(event) => update(key, event.target.value)}
                  placeholder={placeholder}
                />
                {key === 'datasheetPath' || key === 'imagePath' ? (
                  <button
                    className="button secondary"
                    type="button"
                    onClick={async () => {
                      const selected = await desktop.selectFile(
                        key === 'imagePath'
                          ? [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
                          : [{ name: 'Datasheets', extensions: ['pdf'] }],
                      );
                      if (selected) update(key, selected);
                    }}
                  >
                    Browse
                  </button>
                ) : null}
              </span>
            </label>
          ))}
          <label className="field">
            Quantity
            <input
              type="number"
              min="0"
              step="0.01"
              value={quantityText}
              onChange={(event) => handleQuantityChange(event.target.value)}
            />
          </label>
          <label className="field field-wide">
            Notes
            <textarea
              rows={3}
              value={value.notes}
              onChange={(event) => update('notes', event.target.value)}
            />
          </label>
        </div>
        <footer>
          <button className="button ghost" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            type="button"
            disabled={saving || !value.tag.trim() || !quantityText.trim()}
            onClick={onSave}
          >
            {saving ? <LoaderCircle className="spin" /> : <Save />} Save Luminaire
          </button>
        </footer>
      </section>
    </div>
  );
}
