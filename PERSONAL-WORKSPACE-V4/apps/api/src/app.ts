import { ProjectDirectoryStore } from './infrastructure/final-ui/ProjectDirectoryStore';
import { projectDirectoryInputSchema } from '@scli/contracts';
import { personalProfileSchema, projectWizardDraftSchema } from '@scli/contracts';
import { ProjectWizardDraftStore } from './infrastructure/final-ui/ProjectWizardDraftStore';
import { PersonalProfileStore } from './infrastructure/final-ui/PersonalProfileStore';
import { editProjectTechnicalFieldSchema } from '@scli/contracts';
import { keepProjectFieldSchema } from '@scli/contracts';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  StudioTemplateStore,
  studioTemplatesSchema,
} from './infrastructure/luminaire-studio/StudioTemplateStore.js';
import { StudioAssetBridge } from './infrastructure/luminaire-studio/StudioAssetBridge.js';
import { readLuminaireAsset } from './infrastructure/luminaire-assets/LuminaireAssetAccess.js';
import { PdfExtractionAdapter } from './infrastructure/document-intelligence/PdfExtractionAdapter.js';
import {
  StudioOutputService,
  studioOutputRequestSchema,
} from './infrastructure/luminaire-studio/StudioOutputService.js';
import { StudioDocumentStore } from './infrastructure/luminaire-studio/StudioDocumentStore.js';
import { StudioWorkspaceService } from './infrastructure/luminaire-studio/StudioWorkspaceService.js';
import { saveStudioDocumentSchema, datasheetImageSelectionSchema } from '@scli/contracts';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { ZodError, type ZodType } from 'zod';
import type { AppConfig } from '@scli/config';
import { getIntegrationStatus } from '@scli/config';
import { FinalUiPreferenceStore } from './infrastructure/final-ui/FinalUiPreferenceStore';
import { updateFinalUiPreferenceSchema } from '@scli/contracts';
import {
  addCommentSchema,
  assignProjectSchema,
  changeProjectReferenceSchema,
  changeStatusSchema,
  correctTimeEntrySchema,
  createFolderProfileSchema,
  folderProfileParamsSchema,
  importFolderProfileSchema,
  setDefaultFolderProfileSchema,
  updateFolderProfileSchema,
  commitLuminaireImportSchema,
  createUserSchema,
  createProjectSchema,
  createProjectFoldersSchema,
  createRevisionPackageSchema,
  exportLightingPackageSchema,
  importLuminaireCsvSchema,
  folderActionPreviewSchema,
  folderActionSchema,
  legacyProjectFolderScanSchema,
  legacyProjectImportSchema,
  legacyProjectPreviewSchema,
  loginSchema,
  luminaireImportPatchSchema,
  luminaireRecordSchema,
  attachLuminaireAssetSchema,
  legacyDatasheetAdoptionSchema,
  resolveLuminaireDatasheetFieldSchema,
  type LuminaireImportMatchStatus,
  type LuminaireRecordInput,
  personalSettingsSchema,
  personalSalesContactSchema,
  personalProjectTypesSchema,
  periodActivityReportQuerySchema,
  projectActionItemSchema,
  patchProjectActionSchema,
  readinessQuerySchema,
  revisionComparisonQuerySchema,
  registerProjectSourceFileSchema,
  captureSourceBaselineSchema,
  projectChecklistItemSchema,
  projectContactSchema,
  projectDocumentSchema,
  projectMeetingSchema,
  meetingNoteInputSchema,
  linkMeetingActionSchema,
  createActionFromMeetingSchema,
  projectRequirementSchema,
  createProjectTagSchema,
  updateProjectTagSchema,
  createScopeNoteSchema,
  updateScopeNoteSchema,
  createActionCategorySchema,
  updateActionCategorySchema,
  projectReviewItemSchema,
  createProjectReviewThreadSchema,
  createProjectReviewReplySchema,
  updateProjectReviewReplySchema,
  linkProjectReviewDocumentSchema,
  projectRevisionSchema,
  saveFolderProfileSchema,
  scheduleRestoreSchema,
  projectQuerySchema,
  updateProjectSchema,
  fullProjectEditSchema,
  reconnectProjectStorageSchema,
  updateDeliverableSchema,
  updateLightingPackageSchema,
  updateTechnicalScheduleConfigSchema,
  technicalScheduleWorkspaceQuerySchema,
  generateTechnicalScheduleSchema,
  generateTechnicalBoqSchema,
  technicalBoqWorkspaceQuerySchema,
  updateTechnicalBoqConfigSchema,
  updateProjectScopeSchema,
  updateProjectWorkspaceSetupInputSchema,
  updateSettingsSchema,
  updateUserSchema,
  resetPasswordSchema,
  projectEntryParamsSchema,
  projectUserParamsSchema,
  removeProjectFromWorkspaceSchema,
  reviewTimesheetSchema,
  revisionPackageComparisonQuerySchema,
  revisionPackageCatalogQuerySchema,
  routeIdSchema,
  startTimeEntrySchema,
  timesheetQuerySchema,
  workspaceSearchSchema,
  startWorkSessionSchema,
  stopWorkSessionSchema,
  switchWorkSessionSchema,
  pauseWorkSessionSchema,
  resumeWorkSessionSchema,
  workSessionParamsSchema,
  createRevisionDocumentSnapshotSchema,
  addDatasheetDeliverableSchema,
  automationContextParamsSchema,
  automationProjectParamsSchema,
  captureListQuerySchema,
  captureParamsSchema,
  projectDocumentFileHandoffParamsSchema,
  emptyCaptureRetrySchema,
  openAutomationContextSchema,
  startToolSessionSchema,
  testIntegrationLaunchSchema,
  createManualCaptureContextSchema,
  discardCaptureSchema,
  fileHandoffInputSchema,
  outputMappingParamsSchema,
  updateOutputMappingSchema,
  revisionReuseInputSchema,
  prepareRevisionSchema,
  duplicateRevisionSchema,
  updateRevisionMetadataSchema,
  p4dOutputPreviewSchema,
  p4dOutputGenerateSchema,
  addProjectLuminaireFromLibrarySchema,
  archiveLuminaireLibraryEntitySchema,
  compareProjectLuminaireLibrarySchema,
  createLuminaireLibraryAssetSchema,
  createLuminaireLibraryAssetVersionSchema,
  createLuminaireLibraryProductSchema,
  createLuminaireLibraryVariantSchema,
  createProjectLuminaireLibraryDraftSchema,
  createLuminaireManufacturerSchema,
  duplicateLuminaireLibraryQuerySchema,
  luminaireLibraryAssetParamsSchema,
  luminaireLibraryAssetVersionParamsSchema,
  luminaireLibraryListQuerySchema,
  luminaireLibraryManufacturerParamsSchema,
  luminaireLibraryProductParamsSchema,
  luminaireLibraryVariantParamsSchema,
  luminaireManufacturerListQuerySchema,
  projectLuminaireLibraryCreateParamsSchema,
  projectLuminaireLibraryParamsSchema,
  publishLuminaireLibraryVariantSchema,
  updateLuminaireLibraryProductDraftSchema,
  updateLuminaireLibraryVariantDraftSchema,
  updateLuminaireManufacturerSchema,
  updateProjectLuminaireFromLibrarySchema,
  updateProjectLuminaireDescriptionOverrideSchema,
  createImportSessionSchema,
  importHistoryQuerySchema,
  importRowParamsSchema,
  importRowsQuerySchema,
  importSessionParamsSchema,
  importTableParamsSchema,
  reinspectImportSessionSchema,
  updateImportTableSchema,
  reconcileImportSessionSchema,
  updateImportRowActionSchema,
  applyImportSessionSchema,
  importApplyAttemptParamsSchema,
  bulkUpdateImportRowActionsSchema,
  admitArtifactVersionSchema,
  approveRoutingProposalSchema,
  importLibraryGroupDecisionSchema,
  createRoutingProposalSchema,
  cancelDocumentProcessingSchema,
  createDocumentAdmissionSchema,
  completeDocumentAdmissionSchema,
  documentAdmissionParamsSchema,
  documentEvidenceQuerySchema,
  documentListQuerySchema,
  manualOcrSchema,
  documentParamsSchema,
  documentPreviewQuerySchema,
  documentRoutingParamsSchema,
  executeRoutingProposalSchema,
  ownerDocumentDecisionSchema,
  processingAttemptParamsSchema,
  retryDocumentProcessingSchema,
  recomputeConsistencySchema,
} from '@scli/contracts';
import {
  assertPermission,
  canCommentOnProject,
  canManageSettings,
  canonicalizeLuminaireTag,
  DomainError,
  duplicateLuminaireTagMessage,
  isManager,
  normalizeLuminaireTag,
  normalizeScopeItemInputs,
  replaceBuiltInScopeItems,
  supportsLocalIdentity,
  validateProjectFolderDraft,
  projectStatuses,
  priorities,
  actionBlocksIssue,
  type AppUser,
  type AppSettings,
  type DataProvider,
  type FolderProfile,
  type FolderProfileCatalog,
  type FolderProfileRef,
  type LuminaireRecord,
  type Priority,
  type Project,
  type ProjectFolderIndex,
  type ProjectQuery,
  type ProjectStatus,
} from '@scli/domain';
import { createActorResolver, createStandaloneSession } from './auth';
import { MockDataProvider } from './mock-data-provider';
import { StandaloneDataProvider } from './standalone-data-provider';
import { ProjectService } from './project-service';
import { PersonalWorkspaceStore } from './personal-workspace-store';
import { PersonalWorkflowTransitionCoordinator } from './personal-workflow-transition-coordinator';
import { PersonalWorkSessionCoordinator } from './personal-work-session-coordinator';
import { FolderProfileService } from './folder-profile-service';
import { ProjectFolderService } from './project-folder-service';
import { ProjectFolderStructureService } from './project-folder-structure-service';
import { LuminaireExportService } from './luminaire-export-service';
import { importLuminaireCsv } from './luminaire-csv';
import { RevisionPackageService } from './revision-package-service.js';
import { buildPeriodActivityReport } from './period-activity-report.js';
import { buildPeriodReportWorkbook } from './period-report-workbook.js';
import { LegacyProjectImportService, scanProjectFolder } from './legacy-project-import-service.js';
import { LocalIntelligenceService } from './local-intelligence-service.js';
import { TimeTrackingService } from './time-tracking-service.js';
import { ProjectIntelligenceStore } from './infrastructure/project-intelligence/ProjectIntelligenceStore.js';
import {
  MAX_CONTROLLED_SOURCE_BYTES,
  ProjectIntelligenceService,
} from './infrastructure/project-intelligence/ProjectIntelligenceService.js';
import { CanonicalOutputRegistryStore } from './infrastructure/output-registry/CanonicalOutputRegistryStore.js';
import { PackageArtifactAccess } from './infrastructure/output-registry/PackageArtifactAccess.js';
import { CanonicalGenerationService } from './infrastructure/output-registry/CanonicalGenerationService.js';
import { CanonicalIssuePackageService } from './infrastructure/output-registry/CanonicalIssuePackageService.js';
import { CanonicalArtifactReconciler } from './infrastructure/output-registry/CanonicalArtifactReconciler.js';
import { LuminaireScheduleOutputService } from './infrastructure/output-registry/LuminaireScheduleOutputService.js';
import { TechnicalBoqOutputService } from './infrastructure/output-registry/TechnicalBoqOutputService.js';
import { createNonProductionPersonalCanonicalRegistry } from './infrastructure/output-registry/createNonProductionPersonalCanonicalRegistry.js';
import { resolveCanonicalArtifactPresence } from './infrastructure/output-registry/canonical-artifact-files.js';
import { RevisionDeliverableService } from './infrastructure/output-registry/RevisionDeliverableService.js';
import { IssueHistoryService } from './infrastructure/output-registry/IssueHistoryService.js';
import { PackageReproducibilityService } from './infrastructure/output-registry/PackageReproducibilityService.js';
import { RevisionDeleteService } from './infrastructure/output-registry/RevisionDeleteService.js';
import { RevisionDeleteReconciler } from './infrastructure/output-registry/RevisionDeleteReconciler.js';
import { RevisionReuseService } from './infrastructure/output-registry/RevisionReuseService.js';
import { P4DOutputPresentationService } from './infrastructure/output-presentation/P4DOutputPresentationService.js';
import { ManagedArtifactStore } from './infrastructure/managed-artifact/ManagedArtifactStore.js';
import { ToolContextService } from './infrastructure/managed-artifact/ToolContextService.js';
import { CaptureLedgerService } from './infrastructure/managed-artifact/CaptureLedgerService.js';
import { CaptureStagingService } from './infrastructure/managed-artifact/CaptureStagingService.js';
import { AutomationContextService } from './infrastructure/automation/AutomationContextService.js';
import { CaptureDestinationResolver } from './infrastructure/automation/CaptureDestinationResolver.js';
import { CaptureFilingService } from './infrastructure/automation/CaptureFilingService.js';
import { CaptureInboxCoordinator } from './infrastructure/automation/CaptureInboxCoordinator.js';
import { CapturePersistenceService } from './infrastructure/automation/CapturePersistenceService.js';
import { CaptureReadService } from './infrastructure/automation/CaptureReadService.js';
import { CaptureRoutingCoordinator } from './infrastructure/automation/CaptureRoutingCoordinator.js';
import { DesktopHandoffService } from './infrastructure/automation/DesktopHandoffService.js';
import { ToolSessionWorkflowService } from './infrastructure/automation/ToolSessionWorkflowService.js';
import { ManualCaptureService } from './infrastructure/automation/ManualCaptureService.js';
import { CaptureDispositionService } from './infrastructure/automation/CaptureDispositionService.js';
import { ProjectOutputMappingService } from './infrastructure/automation/ProjectOutputMappingService.js';
import { PersonalProjectEditCoordinator } from './personal-project-edit-coordinator.js';
import { ProjectStorageService } from './project-storage-service.js';
import { LuminaireLibraryStore } from './infrastructure/luminaire-library/LuminaireLibraryStore.js';
import { LuminaireLibraryAssetStorage } from './infrastructure/luminaire-library/LuminaireLibraryAssetStorage.js';
import { LuminaireLibraryService } from './infrastructure/luminaire-library/LuminaireLibraryService.js';
import type { WorkspaceBackupService } from './infrastructure/backup/ProductionWorkspaceBackupService.js';
import { ImportSessionStore } from './infrastructure/imports/ImportSessionStore.js';
import {
  ImportSourceAdmission,
  IMPORT_SOURCE_EXTENSIONS,
} from './infrastructure/imports/ImportSourceAdmission.js';
import { ImportInspectionService } from './infrastructure/imports/ImportInspectionService.js';
import { ImportReconciliationService } from './infrastructure/imports/ImportReconciliationService.js';
import { ImportApplyService } from './infrastructure/imports/ImportApplyService.js';
import { ImportLibraryReconciliationService } from './infrastructure/imports/ImportLibraryReconciliationService.js';
import { SqliteLuminaireLibraryDraftWritePort } from './infrastructure/imports/LuminaireLibraryDraftWritePort.js';
import { DocumentIntelligenceStore } from './infrastructure/document-intelligence/DocumentIntelligenceStore.js';
import { DocumentSourceAdmission } from './infrastructure/document-intelligence/DocumentSourceAdmission.js';
import { DocumentProcessingWorker } from './infrastructure/document-intelligence/DocumentProcessingWorker.js';
import { DocumentProcessingCoordinator } from './infrastructure/document-intelligence/DocumentProcessingCoordinator.js';
import { DocumentEvidencePreviewService } from './infrastructure/document-intelligence/DocumentEvidencePreviewService.js';
import { DocumentReviewService } from './infrastructure/document-intelligence/DocumentReviewService.js';
import { CrossDocumentConsistencyService } from './infrastructure/document-intelligence/CrossDocumentConsistencyService.js';
import { DocumentRoutingProposalService } from './infrastructure/document-intelligence/DocumentRoutingProposalService.js';
import { LuminaireDatasheetVerificationService } from './infrastructure/document-intelligence/LuminaireDatasheetVerificationService.js';
import { LegacyDatasheetAdoptionService } from './infrastructure/luminaire-assets/LegacyDatasheetAdoptionService.js';

interface AppOptions {
  config: AppConfig;
  provider: DataProvider;
  clock?: () => Date;
  personalStore?: PersonalWorkspaceStore;
  canonicalOutputRegistry?: CanonicalOutputRegistryStore;
  canonicalGenerationService?: CanonicalGenerationService;
  revisionDeliverableService?: RevisionDeliverableService;
  revisionDeleteService?: RevisionDeleteService;
  revisionReuseService?: RevisionReuseService;
  luminaireLibraryStore?: LuminaireLibraryStore;
  luminaireLibraryService?: LuminaireLibraryService;
  workspaceBackupService?: WorkspaceBackupService;
}

function parsed<T>(schema: ZodType<T>, value: unknown): T {
  return schema.parse(value);
}

/**
 * REV-01A — availability guard for the optional Managed Artifact authority.
 * The v15 managed-artifact schema may be absent on databases that never ran
 * the v15 migration (e.g. older non-production harnesses). In that case the
 * snapshot provenance wiring degrades to the legacy behavior (provenance
 * stays NULL) instead of failing the whole app closed.
 */
function hasManagedArtifactSchema(database: {
  prepare(sql: string): { get(...params: unknown[]): unknown };
}): boolean {
  const row = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'managed_artifacts'")
    .get();
  return row !== undefined;
}

function hasAutomationV20Schema(database: {
  prepare(sql: string): { all(...params: unknown[]): unknown[] };
}): boolean {
  const toolColumns = database.prepare('PRAGMA table_info(tool_contexts)').all() as Array<{
    name?: unknown;
  }>;
  const captureColumns = database.prepare('PRAGMA table_info(capture_ledger)').all() as Array<{
    name?: unknown;
  }>;
  const toolNames = new Set(toolColumns.map((column) => column.name));
  const captureNames = new Set(captureColumns.map((column) => column.name));
  return (
    toolNames.has('target_revision_id') &&
    toolNames.has('source_document_id') &&
    captureNames.has('target_revision_id') &&
    captureNames.has('routing_decision')
  );
}

function hasLuminaireLibrarySchema(database: {
  prepare(sql: string): { get(...params: unknown[]): unknown };
}): boolean {
  return (
    database
      .prepare(
        "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'luminaire_library_versions'",
      )
      .get() !== undefined
  );
}

function hasImportInspectionSchema(database: {
  prepare(sql: string): { get(...params: unknown[]): unknown };
}): boolean {
  return (
    database
      .prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'import_sessions'")
      .get() !== undefined
  );
}

function hasDocumentIntelligenceSchema(database: {
  prepare(sql: string): { get(...params: unknown[]): unknown };
}): boolean {
  return (
    database
      .prepare(
        "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'intelligence_documents'",
      )
      .get() !== undefined
  );
}

function hasLuminaireDatasheetVerificationSchema(database: {
  prepare(sql: string): { get(...params: unknown[]): unknown };
}): boolean {
  return (
    database
      .prepare(
        "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'luminaire_datasheet_verifications'",
      )
      .get() !== undefined
  );
}

function success<T>(reply: FastifyReply, request: FastifyRequest, data: T, statusCode = 200) {
  return reply.code(statusCode).send({ data, correlationId: request.id });
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

/** Backward-compatible catalog view: canonical ref plus the legacy defaultProfileId. */
function folderProfileCatalogView(catalog: FolderProfileCatalog): {
  schemaVersion: FolderProfileCatalog['schemaVersion'];
  profiles: FolderProfile[];
  defaultProfileRef: FolderProfileRef;
  defaultProfileId: string | null;
} {
  return {
    schemaVersion: catalog.schemaVersion,
    profiles: catalog.profiles,
    defaultProfileRef: catalog.defaultProfileRef,
    defaultProfileId:
      catalog.defaultProfileRef.kind === 'user' ? catalog.defaultProfileRef.profileId : null,
  };
}

function queryFromInput(input: ReturnType<typeof projectQuerySchema.parse>): ProjectQuery {
  const statuses = input.status
    ?.split(',')
    .filter((status): status is ProjectStatus => projectStatuses.includes(status as ProjectStatus));
  const selectedPriorities = input.priority
    ?.split(',')
    .filter((priority): priority is Priority => priorities.includes(priority as Priority));
  return {
    ...(input.search ? { search: input.search } : {}),
    ...(statuses?.length ? { statuses } : {}),
    ...(input.designerId ? { designerId: input.designerId } : {}),
    ...(input.salesOwnerId ? { salesOwnerId: input.salesOwnerId } : {}),
    ...(selectedPriorities?.length ? { priorities: selectedPriorities } : {}),
    ...(input.projectType ? { projectType: input.projectType } : {}),
    ...(input.clientName ? { clientName: input.clientName } : {}),
    ...(input.dueFrom ? { dueFrom: input.dueFrom } : {}),
    ...(input.dueTo ? { dueTo: input.dueTo } : {}),
    ...(input.sortBy ? { sortBy: input.sortBy } : {}),
    ...(input.sortDirection ? { sortDirection: input.sortDirection } : {}),
  };
}

export async function createApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      options.config.LOG_LEVEL === 'silent'
        ? false
        : {
            level: options.config.LOG_LEVEL,
            redact: [
              'req.headers.authorization',
              'req.headers.cookie',
              '*.accessToken',
              '*.clientSecret',
            ],
          },
    genReqId: (request) => {
      const provided = request.headers['x-correlation-id'];
      return typeof provided === 'string' && /^[a-zA-Z0-9-]{8,80}$/.test(provided)
        ? provided
        : randomUUID();
    },
    bodyLimit: 6_000_000,
    requestTimeout: 30_000,
  });
  await app.register(cors, {
    origin:
      options.config.NODE_ENV === 'production'
        ? [options.config.WEB_ORIGIN]
        : [options.config.WEB_ORIGIN, 'http://127.0.0.1:5173'],
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'content-type',
      'authorization',
      'x-mock-user-id',
      'x-correlation-id',
      'x-test-reset',
      'x-import-file-name',
      'x-document-file-name',
      'x-document-idempotency-key',
      'x-document-project-id',
    ],
  });
  await app.register(helmet, {
    frameguard: false,
    contentSecurityPolicy:
      options.config.NODE_ENV === 'production'
        ? {
            directives: {
              defaultSrc: ["'self'"],
              baseUri: ["'self'"],
              connectSrc: ["'self'", 'https://login.microsoftonline.com'],
              fontSrc: ["'self'", 'data:'],
              formAction: ["'self'"],
              frameAncestors: [
                "'self'",
                'https://*.teams.microsoft.com',
                'https://*.microsoft365.com',
                'https://*.office.com',
              ],
              imgSrc: ["'self'", 'data:', 'https:'],
              objectSrc: ["'none'"],
              scriptSrc: ["'self'"],
              scriptSrcAttr: ["'none'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              upgradeInsecureRequests: null,
            },
          }
        : false,
  });

  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit: 52 * 1024 * 1024 },
    (_request, body, done) => {
      done(null, body);
    },
  );

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-correlation-id', request.id);
  });

  const resolveActor = createActorResolver(options.config, options.provider);
  const ownsPersonalStore = options.personalStore === undefined;
  const personalStore = options.personalStore ?? new PersonalWorkspaceStore(options.config);
  const libraryDatabase = personalStore.getSharedDatabase();
  const dataRoot = path.dirname(path.resolve(process.cwd(), options.config.STANDALONE_DB_PATH));
  const localVision =
    options.config.LOCAL_AI_ENABLED && options.config.LOCAL_AI_PORT
      ? new LocalVisionAdapter(options.config.LOCAL_AI_PORT)
      : null;
  const localAiReview = localVision ? new LocalAiReview(dataRoot, localVision) : null;
  app.addHook('onClose', async () => {
    await localAiReview?.close();
  });
  const desktopHandoffs = new DesktopHandoffService(dataRoot, options.clock);
  const documentSourceAdmission = hasDocumentIntelligenceSchema(libraryDatabase)
    ? new DocumentSourceAdmission(dataRoot)
    : undefined;
  const documentIntelligenceStore = hasDocumentIntelligenceSchema(libraryDatabase)
    ? new DocumentIntelligenceStore(libraryDatabase, options.clock)
    : undefined;
  const projectStorageForDocuments = new ProjectStorageService(
    options.provider,
    personalStore,
    undefined,
    options.clock,
  );
  const resolveDocumentArtifactSource = async (artifactVersionId: string): Promise<string> => {
    const row = libraryDatabase
      .prepare(
        `SELECT av.locator_value,ma.project_id FROM artifact_versions av JOIN managed_artifacts ma ON ma.artifact_id=av.artifact_id WHERE av.version_id=?`,
      )
      .get(artifactVersionId) as { locator_value?: unknown; project_id?: unknown } | undefined;
    if (!row || typeof row.locator_value !== 'string' || typeof row.project_id !== 'string')
      throw new Error('ARTIFACT_SOURCE_NOT_FOUND');
    const project = await options.provider.getProject(row.project_id);
    if (!project) throw new Error('ARTIFACT_PROJECT_NOT_FOUND');
    const root = await projectStorageForDocuments.resolveVerifiedProjectRoot(project);
    const candidate = path.resolve(root, row.locator_value);
    const relative = path.relative(root, candidate);
    if (
      !relative ||
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    )
      throw new Error('ARTIFACT_SOURCE_OUTSIDE_PROJECT');
    return candidate;
  };
  const luminaireAssetStorage = new LuminaireLibraryAssetStorage(dataRoot);
  const resolveDocumentLuminaireAssetSource = async (
    luminaireAssetVersionId: string,
  ): Promise<string> => {
    const row = libraryDatabase
      .prepare(
        `SELECT id,project_id,luminaire_id,asset_type,mime_type,size_bytes,file_hash,
                locator_kind,locator_value
         FROM luminaire_asset_versions WHERE id=?`,
      )
      .get(luminaireAssetVersionId) as
      | {
          id?: unknown;
          project_id?: unknown;
          luminaire_id?: unknown;
          asset_type?: unknown;
          mime_type?: unknown;
          size_bytes?: unknown;
          file_hash?: unknown;
          locator_kind?: unknown;
          locator_value?: unknown;
        }
      | undefined;
    if (
      !row ||
      row.id !== luminaireAssetVersionId ||
      row.asset_type !== 'Datasheet' ||
      row.mime_type !== 'application/pdf' ||
      typeof row.project_id !== 'string' ||
      typeof row.luminaire_id !== 'string' ||
      typeof row.file_hash !== 'string' ||
      !/^[0-9a-f]{64}$/.test(row.file_hash) ||
      typeof row.locator_value !== 'string'
    ) {
      throw new Error('LUMINAIRE_DATASHEET_ASSET_AUTHORITY_INVALID');
    }
    let candidate: string;
    let allowedRoot: string;
    if (row.locator_kind === 'DATA_ROOT_RELATIVE') {
      candidate = luminaireAssetStorage.resolveLocator(row.locator_value);
      allowedRoot = await realpath(dataRoot);
    } else if (row.locator_kind === 'LEGACY_PATH') {
      const project = await options.provider.getProject(row.project_id);
      if (!project) throw new Error('LUMINAIRE_DATASHEET_PROJECT_NOT_FOUND');
      allowedRoot = await realpath(
        await projectStorageForDocuments.resolveVerifiedProjectRoot(project),
      );
      candidate = path.resolve(row.locator_value);
    } else {
      throw new Error('LUMINAIRE_DATASHEET_LOCATOR_UNSUPPORTED');
    }
    let metadata;
    let canonical: string;
    try {
      metadata = await lstat(candidate);
      canonical = await realpath(candidate);
    } catch {
      throw new Error('SOURCE_FILE_MISSING');
    }
    const relative = path.relative(allowedRoot, canonical);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      !relative ||
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error('LUMINAIRE_DATASHEET_SOURCE_OUTSIDE_MANAGED_AUTHORITY');
    }
    const bytes = await readFile(canonical);
    if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new Error('PDF_VALIDATION_FAILED');
    }
    if (
      bytes.length !== Number(row.size_bytes) ||
      createHash('sha256').update(bytes).digest('hex') !== row.file_hash
    ) {
      throw new Error('SOURCE_HASH_MISMATCH');
    }
    return canonical;
  };
  const documentProcessingWorker =
    documentIntelligenceStore && documentSourceAdmission
      ? new DocumentProcessingWorker(
          documentIntelligenceStore,
          documentSourceAdmission,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          resolveDocumentArtifactSource,
          () => options.provider.listProjects(),
          resolveDocumentLuminaireAssetSource,
        )
      : undefined;
  const documentProcessingCoordinator =
    documentIntelligenceStore && documentProcessingWorker
      ? new DocumentProcessingCoordinator(documentIntelligenceStore, documentProcessingWorker)
      : undefined;
  const luminaireDatasheetVerificationService =
    documentIntelligenceStore &&
    documentProcessingWorker &&
    hasLuminaireDatasheetVerificationSchema(libraryDatabase)
      ? new LuminaireDatasheetVerificationService(
          libraryDatabase,
          documentIntelligenceStore,
          documentProcessingWorker,
          options.clock,
        )
      : undefined;
  const documentEvidencePreview =
    documentIntelligenceStore && documentSourceAdmission
      ? new DocumentEvidencePreviewService(
          documentIntelligenceStore,
          documentSourceAdmission,
          undefined,
          resolveDocumentArtifactSource,
          resolveDocumentLuminaireAssetSource,
        )
      : undefined;
  const documentReviewService = documentIntelligenceStore
    ? new DocumentReviewService(documentIntelligenceStore)
    : undefined;
  documentSourceAdmission?.reconcileStaging(new Set());
  documentProcessingCoordinator?.reconcileStartup();
  const documents = () => {
    if (
      !documentSourceAdmission ||
      !documentIntelligenceStore ||
      !documentProcessingCoordinator ||
      !documentEvidencePreview ||
      !documentReviewService
    ) {
      throw new DomainError('CONFLICT', 'Document Intelligence requires schema v27.', 409);
    }
    return {
      admission: documentSourceAdmission,
      store: documentIntelligenceStore,
      coordinator: documentProcessingCoordinator,
      preview: documentEvidencePreview,
      review: documentReviewService,
    };
  };
  const importSourceAdmission = hasImportInspectionSchema(libraryDatabase)
    ? new ImportSourceAdmission(dataRoot)
    : undefined;
  const importSessionStore = hasImportInspectionSchema(libraryDatabase)
    ? new ImportSessionStore(libraryDatabase, options.clock)
    : undefined;
  const importInspectionService =
    importSessionStore && importSourceAdmission
      ? new ImportInspectionService(importSessionStore, importSourceAdmission)
      : undefined;
  importSourceAdmission?.cleanupOrphans();
  const imports = () => {
    if (!importSessionStore || !importSourceAdmission || !importInspectionService) {
      throw new DomainError('CONFLICT', 'Smart Import requires schema v25.', 409);
    }
    return {
      store: importSessionStore,
      admission: importSourceAdmission,
      service: importInspectionService,
    };
  };
  const luminaireLibraryStore =
    options.luminaireLibraryStore ??
    (hasLuminaireLibrarySchema(libraryDatabase)
      ? new LuminaireLibraryStore(libraryDatabase, options.clock)
      : undefined);
  const luminaireLibraryService =
    options.luminaireLibraryService ??
    (luminaireLibraryStore
      ? new LuminaireLibraryService(
          luminaireLibraryStore,
          new LuminaireLibraryAssetStorage(
            path.dirname(path.resolve(process.cwd(), options.config.STANDALONE_DB_PATH)),
          ),
          options.clock,
        )
      : undefined);
  const library = (): { store: LuminaireLibraryStore; service: LuminaireLibraryService } => {
    if (!luminaireLibraryStore || !luminaireLibraryService) {
      throw new DomainError('CONFLICT', 'Master Luminaire Library requires schema v22.', 409);
    }
    return { store: luminaireLibraryStore, service: luminaireLibraryService };
  };
  const importReconciliationService = importSessionStore
    ? new ImportReconciliationService(importSessionStore, options.clock)
    : undefined;
  const importLibraryDrafts =
    importSessionStore && luminaireLibraryStore
      ? new SqliteLuminaireLibraryDraftWritePort(libraryDatabase, options.clock)
      : undefined;
  const importLibraryReconciliationService =
    importSessionStore && importLibraryDrafts
      ? new ImportLibraryReconciliationService(
          importSessionStore,
          importLibraryDrafts,
          options.clock,
        )
      : undefined;
  const importApplyService =
    importSessionStore && luminaireLibraryService && options.workspaceBackupService
      ? new ImportApplyService(
          importSessionStore,
          luminaireLibraryService,
          options.workspaceBackupService,
          options.clock,
          undefined,
          importLibraryDrafts,
        )
      : undefined;
  const folderProfileService = new FolderProfileService(personalStore);
  const folderService = new ProjectFolderService();
  const projectStorageService = projectStorageForDocuments;
  const legacyDatasheetAdoptionService = hasLuminaireDatasheetVerificationSchema(libraryDatabase)
    ? new LegacyDatasheetAdoptionService(
        libraryDatabase,
        personalStore,
        projectStorageService,
        luminaireAssetStorage,
        {
          createVerifiedBackup: async (reason) =>
            options.workspaceBackupService
              ? options.workspaceBackupService.createVerifiedBackup(reason)
              : { backupId: path.basename(personalStore.createBackup(reason)) },
        },
        options.clock,
      )
    : undefined;
  documentProcessingCoordinator?.notifyQueued();
  const folderStructureService = new ProjectFolderStructureService(
    personalStore,
    folderService,
    options.clock ?? (() => new Date()),
  );
  const exportService = new LuminaireExportService(options.config);
  const registryClock = { now: options.clock ?? (() => new Date()) };
  const scheduleCanonicalRegistry =
    options.canonicalOutputRegistry ??
    (options.config.WORKSPACE_VARIANT === 'personal' && options.config.NODE_ENV !== 'production'
      ? createNonProductionPersonalCanonicalRegistry(personalStore, registryClock)
      : undefined);
  const canonicalGenerationService =
    options.canonicalGenerationService ??
    (scheduleCanonicalRegistry
      ? new CanonicalGenerationService(personalStore, scheduleCanonicalRegistry, exportService)
      : undefined);
  const scheduleGenerationService =
    options.canonicalGenerationService ??
    (scheduleCanonicalRegistry
      ? new CanonicalGenerationService(personalStore, scheduleCanonicalRegistry, exportService)
      : undefined);
  const luminaireScheduleOutputService = scheduleCanonicalRegistry
    ? new LuminaireScheduleOutputService(personalStore, scheduleCanonicalRegistry)
    : undefined;
  const technicalBoqOutputService = scheduleCanonicalRegistry
    ? new TechnicalBoqOutputService(personalStore, scheduleCanonicalRegistry)
    : undefined;
  const p4dOutputPresentationService = scheduleCanonicalRegistry
    ? new P4DOutputPresentationService(personalStore, scheduleCanonicalRegistry)
    : undefined;
  const canonicalIssuePackageService = scheduleCanonicalRegistry
    ? new CanonicalIssuePackageService(
        personalStore,
        scheduleCanonicalRegistry,
        options.clock ?? (() => new Date()),
      )
    : undefined;
  const issueHistoryService = scheduleCanonicalRegistry
    ? new IssueHistoryService(scheduleCanonicalRegistry)
    : undefined;
  const packageReproducibilityService = scheduleCanonicalRegistry
    ? new PackageReproducibilityService(scheduleCanonicalRegistry, (projectId) =>
        personalStore.getProjectFolderPath(projectId),
      )
    : undefined;
  const revisionPackageService = new RevisionPackageService(
    personalStore,
    canonicalIssuePackageService,
  );
  const revisionDeliverableService =
    options.revisionDeliverableService ??
    (scheduleCanonicalRegistry
      ? new RevisionDeliverableService(
          personalStore,
          scheduleCanonicalRegistry,
          hasManagedArtifactSchema(personalStore.getSharedDatabase())
            ? new ManagedArtifactStore(personalStore.getSharedDatabase())
            : undefined,
        )
      : undefined);
  // P2C-03 — Safe Revision Delete authority. Wired only when the canonical
  // registry is present so the delete aggregate has a real Revision authority.
  const revisionDeleteService =
    options.revisionDeleteService ??
    (scheduleCanonicalRegistry
      ? new RevisionDeleteService(
          personalStore,
          scheduleCanonicalRegistry,
          options.clock ?? (() => new Date()),
        )
      : undefined);
  const revisionReuseService =
    options.revisionReuseService ??
    (scheduleCanonicalRegistry
      ? new RevisionReuseService(
          personalStore,
          scheduleCanonicalRegistry,
          options.clock ?? (() => new Date()),
        )
      : undefined);
  if (scheduleCanonicalRegistry) {
    const reconciliation = await new CanonicalArtifactReconciler(
      scheduleCanonicalRegistry,
      (projectId) => personalStore.getProjectFolderPath(projectId),
    ).reconcile();
    if (reconciliation.issues.length > 0) {
      app.log.warn(
        {
          issueCount: reconciliation.issues.length,
          finalizedOutputs: reconciliation.finalizedOutputs,
          failedOutputs: reconciliation.failedOutputs,
          discardedOutputReservations: reconciliation.discardedOutputReservations,
          finalizedRevisions: reconciliation.finalizedRevisions,
          failedRevisions: reconciliation.failedRevisions,
          finalizedPackages: reconciliation.finalizedPackages,
          failedPackages: reconciliation.failedPackages,
        },
        'Canonical artifact reconciliation found recoverable attention items.',
      );
    }
    // P2C-03 — narrow startup reconciliation for incomplete Revision Delete
    // operations. No silent destructive guessing: DB_COMMITTED operations are
    // completed (the deletion is already durable); non-terminal operations are
    // surfaced as FAILED_RECOVERABLE for an owner-driven Retry Delete.
    const deleteReconciliation = new RevisionDeleteReconciler(
      scheduleCanonicalRegistry,
    ).reconcile();
    if (
      deleteReconciliation.completed.length > 0 ||
      deleteReconciliation.surfacedRecoverable.length > 0
    ) {
      app.log.warn(
        {
          completedDeleteOperations: deleteReconciliation.completed.length,
          recoverableDeleteOperations: deleteReconciliation.surfacedRecoverable.length,
        },
        'Revision Delete reconciliation completed durable operations and surfaced interrupted ones for retry.',
      );
    }
  }
  const localIntelligenceService = new LocalIntelligenceService();
  // P5D — Project Intelligence & Productivity. The source store is additive on
  // the shared connection (v28 tables); the orchestrating service delegates to
  // existing authorities (workspace health checks, Local Intelligence,
  // canonical Revision registry, Project storage health) and never guesses
  // product policy.
  const projectIntelligenceStore = new ProjectIntelligenceStore(libraryDatabase);
  const projectIntelligenceService = new ProjectIntelligenceService({
    personalStore: { getWorkspace: (projectId) => personalStore.getWorkspace(projectId) },
    registry: scheduleCanonicalRegistry,
    sourceStore: projectIntelligenceStore,
    storageHealth: (project) => projectStorageService.getHealth(project),
    localIntelligence: async (input) => {
      const folderIndex = personalStore.getFolderIndex(input.project.id);
      const overview = await localIntelligenceService.overview(
        input.project,
        input.workspace,
        folderIndex,
      );
      return { checks: overview.checks };
    },
    clock: options.clock,
  });
  const legacyProjectImportService = new LegacyProjectImportService(
    options.provider,
    personalStore,
  );
  let captureInboxCoordinator: CaptureInboxCoordinator | undefined;
  app.addHook('onClose', async () => {
    await documentProcessingCoordinator?.close();
    await captureInboxCoordinator?.close();
    if (ownsPersonalStore) personalStore.close();
  });
  // Only wire the Personal atomic coordinator when the provider and store share
  // ONE connection (production startup). Legacy tests that construct separate
  // connections keep the committed non-atomic Personal path, so their behavior
  // is unchanged.
  const personalWorkflowCoordinator =
    options.provider instanceof StandaloneDataProvider &&
    personalStore &&
    options.provider.getSharedDatabase() === personalStore.getSharedDatabase()
      ? new PersonalWorkflowTransitionCoordinator(options.provider, personalStore)
      : undefined;
  // P2.8A — Personal WorkSession coordinator. Only wired when the provider and
  // store share ONE connection (production startup). It is a separate durable
  // structured-row model and is deliberately NOT the Team TimeTrackingService.
  const personalWorkSessionCoordinator =
    options.provider instanceof StandaloneDataProvider &&
    personalStore &&
    options.provider.getSharedDatabase() === personalStore.getSharedDatabase()
      ? new PersonalWorkSessionCoordinator(options.provider, personalStore)
      : undefined;
  const personalProjectEditCoordinator =
    options.provider instanceof StandaloneDataProvider &&
    options.provider.getSharedDatabase() === personalStore.getSharedDatabase()
      ? new PersonalProjectEditCoordinator(options.provider, personalStore)
      : undefined;
  const managedArtifactStore = hasAutomationV20Schema(personalStore.getSharedDatabase())
    ? new ManagedArtifactStore(personalStore.getSharedDatabase())
    : undefined;
  const documentConsistencyService = documentIntelligenceStore
    ? new CrossDocumentConsistencyService(libraryDatabase, documentIntelligenceStore)
    : undefined;
  const documentRoutingService =
    documentIntelligenceStore && documentSourceAdmission && managedArtifactStore
      ? new DocumentRoutingProposalService(
          libraryDatabase,
          documentIntelligenceStore,
          documentSourceAdmission,
          options.provider,
          personalStore,
          projectStorageService,
          options.clock,
        )
      : undefined;
  const toolContextService = managedArtifactStore
    ? new ToolContextService(managedArtifactStore)
    : undefined;
  const captureLedgerService = managedArtifactStore
    ? new CaptureLedgerService(managedArtifactStore)
    : undefined;
  const automationContextService = managedArtifactStore
    ? new AutomationContextService(
        personalStore.getSharedDatabase(),
        managedArtifactStore,
        options.clock,
      )
    : undefined;
  automationContextService?.expireActiveContextsAfterRestart();
  let captureRoutingCoordinator: CaptureRoutingCoordinator | undefined;
  let captureReadService: CaptureReadService | undefined;
  let toolSessionWorkflowService: ToolSessionWorkflowService | undefined;
  let manualCaptureService: ManualCaptureService | undefined;
  let captureDispositionService: CaptureDispositionService | undefined;
  const projectOutputMappingService = new ProjectOutputMappingService(personalStore);
  if (
    options.config.WORKSPACE_VARIANT === 'personal' &&
    scheduleCanonicalRegistry?.isCanonicalAuthority() &&
    managedArtifactStore &&
    toolContextService &&
    captureLedgerService
  ) {
    const staging = new CaptureStagingService({
      store: managedArtifactStore,
      captures: captureLedgerService,
      dataRoot,
    });
    const destinations = new CaptureDestinationResolver(
      options.provider,
      personalStore,
      projectStorageService,
      scheduleCanonicalRegistry,
    );
    const persistence = new CapturePersistenceService(
      personalStore,
      managedArtifactStore,
      captureLedgerService,
      scheduleCanonicalRegistry,
    );
    captureRoutingCoordinator = new CaptureRoutingCoordinator(
      dataRoot,
      toolContextService,
      captureLedgerService,
      staging,
      managedArtifactStore,
      destinations,
      new CaptureFilingService(),
      persistence,
      options.clock,
    );
    captureReadService = new CaptureReadService(
      options.provider,
      captureLedgerService,
      managedArtifactStore,
      scheduleCanonicalRegistry,
    );
    toolSessionWorkflowService = new ToolSessionWorkflowService(
      personalStore.getSharedDatabase(),
      options.provider,
      projectStorageService,
      automationContextService!,
      desktopHandoffs,
      dataRoot,
    );
    manualCaptureService = new ManualCaptureService(
      personalStore.getSharedDatabase(),
      options.provider,
      projectStorageService,
      automationContextService!,
      desktopHandoffs,
      dataRoot,
      options.clock,
    );
    captureDispositionService = new CaptureDispositionService(
      options.provider,
      captureLedgerService,
      managedArtifactStore,
      projectStorageService,
      desktopHandoffs,
      options.clock,
    );
    captureInboxCoordinator = new CaptureInboxCoordinator(
      dataRoot,
      toolContextService,
      captureRoutingCoordinator,
    );
    await captureInboxCoordinator.start();
  }
  const service = new ProjectService(
    options.provider,
    options.config.COMPANY_TIMEZONE,
    options.clock,
    options.config.WORKSPACE_VARIANT,
    personalWorkflowCoordinator,
    (id) =>
      new ProjectDirectoryStore(personalStore.getSharedDatabase(), options.clock)
        .list()
        .find((entry) => entry.kind === 'Manager' && entry.id === id),
  );
  const timeTrackingService = new TimeTrackingService(options.provider, options.clock);
  const actor = (request: FastifyRequest): Promise<AppUser> => resolveActor(request);
  const syncPersonalProjectProgress = async (projectId: string) => {
    const project = await options.provider.getProject(projectId);
    if (!project) return;
    const workspace = personalStore.getWorkspace(projectId);
    const tracked = workspace.deliverables.filter(
      (item) => item.required && item.status !== 'NotRequired',
    );
    const progressPercent = tracked.length
      ? Math.round(tracked.reduce((sum, item) => sum + item.progressPercent, 0) / tracked.length)
      : 0;
    await options.provider.updateProject(projectId, {
      progressPercent,
      updatedAt: new Date().toISOString(),
      version: project.version + 1,
    });
  };
  const restoreReferenceAfterFailedRename = async (input: {
    projectId: string;
    snapshot: Project;
    renameResult: { oldPath: string; newPath: string } | null;
    oldIndex: ProjectFolderIndex;
  }): Promise<{ restored: boolean; failed: string[] }> => {
    const failed: string[] = [];
    try {
      await service.restoreProjectReferenceSnapshot(input.projectId, input.snapshot);
    } catch {
      failed.push('project');
    }
    try {
      if (input.snapshot.projectFolderPath) {
        personalStore.setFolderPath(input.projectId, input.snapshot.projectFolderPath);
      }
    } catch {
      failed.push('workspace');
    }
    try {
      personalStore.replaceFolderIndex(input.oldIndex);
    } catch {
      failed.push('index');
    }
    try {
      if (input.renameResult) {
        folderService.restoreManagedProjectFolder(
          input.renameResult.newPath,
          input.renameResult.oldPath,
        );
      }
    } catch {
      failed.push('folder');
    }
    return { restored: failed.length === 0, failed };
  };
  const recoveryRequiredError = (
    previousCode: string,
    requestedCode: string,
    failed: string[],
  ): DomainError =>
    new DomainError(
      'CONFLICT',
      'The project reference could not be updated safely. Manual recovery is required for the project folder.',
      409,
      {
        recoveryRequired: true,
        previousProjectCode: previousCode,
        requestedProjectCode: requestedCode,
        failedSteps: failed,
      },
    );
  const createPersonalPeriodReport = async (
    current: AppUser,
    input: {
      from: string;
      to: string;
      salesOwnerId?: string | undefined;
      search?: string | undefined;
    },
  ) => {
    const projects = (await service.listProjects(current, {})).filter(
      (project) =>
        !input.search ||
        `${project.projectName} ${project.projectCode} ${project.clientName}`
          .toLowerCase()
          .includes(input.search.toLowerCase()),
    );
    const [users, activityEntries] = await Promise.all([
      options.provider.listUsers(),
      Promise.all(
        projects.map(
          async (project) =>
            [project.id, await options.provider.listActivities(project.id)] as const,
        ),
      ),
    ]);
    const workspaces = new Map(
      projects.map((project) => [project.id, personalStore.getWorkspace(project.id)] as const),
    );
    const revisions = new Map(
      projects.map((project) => [
        project.id,
        scheduleCanonicalRegistry?.listRevisions(project.id) ?? [],
      ]),
    );
    const readiness = new Map(
      await Promise.all(
        projects.map(async (project) => {
          const latest = revisions.get(project.id)?.[0];
          if (!latest) return [project.id, null] as const;
          const result = await projectIntelligenceService.readiness(project, latest.revisionId);
          return [
            project.id,
            {
              revisionId: latest.revisionId,
              revisionLabel: latest.revisionLabel,
              level: result.level,
              blockers: result.counts.blockers,
              warnings: result.counts.warnings,
            },
          ] as const;
        }),
      ),
    );
    return buildPeriodActivityReport({
      readiness,
      workSessions: new Map(
        projects.map((project) => [project.id, personalStore.listWorkSessions(project.id)]),
      ),
      ...(toolSessionWorkflowService
        ? {
            toolSessions: new Map(
              projects.map((project) => [project.id, toolSessionWorkflowService!.list(project.id)]),
            ),
          }
        : {}),
      projects,
      activities: new Map(activityEntries),
      workspaces,
      ...(scheduleCanonicalRegistry
        ? {
            canonicalPackages: new Map(
              projects.map((project) => [
                project.id,
                scheduleCanonicalRegistry.listIssuePackages(project.id),
              ]),
            ),
            canonicalOutputs: new Map(
              projects.map((project) => [
                project.id,
                scheduleCanonicalRegistry.listOutputs(project.id),
              ]),
            ),
            canonicalRevisions: revisions,
          }
        : {}),
      users,
      from: input.from,
      to: input.to,
      ...(input.salesOwnerId ? { salesOwnerId: input.salesOwnerId } : {}),
      timeZone: options.config.COMPANY_TIMEZONE,
    });
  };
  const loginFailures = new Map<string, { count: number; resetAt: number }>();

  app.get('/api/health', async (request, reply) =>
    success(reply, request, {
      status: 'ok',
      mode: options.config.APP_MODE,
      timestamp: new Date().toISOString(),
    }),
  );

  app.get('/api/integration-status', async (request, reply) =>
    success(reply, request, getIntegrationStatus(options.config)),
  );

  app.post('/api/auth/login', async (request, reply) => {
    if (options.config.APP_MODE !== 'standalone' || !supportsLocalIdentity(options.provider)) {
      throw new DomainError('NOT_FOUND', 'Standalone sign-in is not available.', 404);
    }
    const input = parsed(loginSchema, request.body);
    const key = `${request.ip}:${input.email.toLowerCase()}`;
    const now = Date.now();
    const failure = loginFailures.get(key);
    if (failure && failure.resetAt > now && failure.count >= 5) {
      throw new DomainError(
        'RATE_LIMITED',
        'Too many sign-in attempts. Wait 15 minutes and try again.',
        429,
      );
    }
    const user = await options.provider.verifyCredentials(input.email, input.password);
    if (!user) {
      const current = failure && failure.resetAt > now ? failure.count : 0;
      loginFailures.set(key, { count: current + 1, resetAt: now + 15 * 60 * 1000 });
      throw new DomainError('AUTHENTICATION_REQUIRED', 'Email or password is incorrect.', 401);
    }
    loginFailures.delete(key);
    return success(reply, request, {
      token: await createStandaloneSession(options.config, user),
      expiresInHours: options.config.STANDALONE_SESSION_HOURS,
      user,
    });
  });

  app.get('/api/dev/users', async (request, reply) => {
    if (options.config.APP_MODE !== 'mock') {
      throw new DomainError('NOT_FOUND', 'Route not found.', 404);
    }
    const users = (await options.provider.listUsers()).filter((user) => user.isActive);
    return success(reply, request, users);
  });

  app.post('/api/test/reset', async (request, reply) => {
    if (
      options.config.APP_MODE !== 'mock' ||
      options.config.NODE_ENV === 'production' ||
      request.headers['x-test-reset'] !== 'scli-e2e' ||
      !(options.provider instanceof MockDataProvider)
    ) {
      throw new DomainError('NOT_FOUND', 'Route not found.', 404);
    }
    options.provider.reset();
    return success(reply, request, { reset: true });
  });

  app.get('/api/me', async (request, reply) => success(reply, request, await actor(request)));

  const authorizedImportSession = async (request: FastifyRequest, id: string) => {
    const current = await actor(request);
    const session = imports().store.get(id);
    if (session.actorId !== current.id) {
      throw new DomainError(
        'PERMISSION_DENIED',
        'This Import Session belongs to another workspace user.',
        403,
      );
    }
    if (session.projectId) await service.getProject(current, session.projectId);
    return { current, session };
  };

  const authorizedImportOwner = async (request: FastifyRequest, id: string) => {
    const authorized = await authorizedImportSession(request, id);
    assertPermission(
      options.config.WORKSPACE_VARIANT === 'personal' && canManageSettings(authorized.current),
      'Only the Personal workspace owner can review and apply Project imports.',
    );
    return authorized;
  };

  app.post('/api/imports', async (request, reply) => {
    const current = await actor(request);
    const input = parsed(createImportSessionSchema, request.body);
    if (input.projectId) await service.getProject(current, input.projectId);
    return success(reply, request, imports().service.create(input, current), 201);
  });

  app.get('/api/imports', async (request, reply) => {
    const current = await actor(request);
    return success(
      reply,
      request,
      imports().store.list(current.id, parsed(importHistoryQuerySchema, request.query)),
    );
  });

  app.get('/api/imports/:id', async (request, reply) => {
    const { id } = parsed(importSessionParamsSchema, request.params);
    return success(reply, request, (await authorizedImportSession(request, id)).session);
  });

  app.post('/api/imports/:id/source-handoff', async (request, reply) => {
    const { id } = parsed(importSessionParamsSchema, request.params);
    const { session } = await authorizedImportSession(request, id);
    if (session.sourceSha256)
      throw new DomainError('CONFLICT', 'This Import Session already has a source.', 409);
    const inboxPath = imports().admission.prepareDesktopInbox(id);
    return success(
      reply,
      request,
      desktopHandoffs.create({
        action: 'SELECT_IMPORT_SOURCE',
        importSessionId: id,
        inboxPath,
        allowedExtensions: [...IMPORT_SOURCE_EXTENSIONS],
      }),
      201,
    );
  });

  app.post('/api/imports/:id/source-handoff/complete', async (request, reply) => {
    const { id } = parsed(importSessionParamsSchema, request.params);
    await authorizedImportSession(request, id);
    return success(reply, request, await imports().service.inspectDesktopSelection(id), 201);
  });

  app.post('/api/imports/:id/source', { bodyLimit: 26 * 1024 * 1024 }, async (request, reply) => {
    const { id } = parsed(importSessionParamsSchema, request.params);
    await authorizedImportSession(request, id);
    const fileName = request.headers['x-import-file-name'];
    if (
      typeof fileName !== 'string' ||
      fileName.length < 1 ||
      fileName.length > 512 ||
      !Buffer.isBuffer(request.body)
    ) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'A bounded binary source and filename are required.',
        400,
      );
    }
    let decodedFileName: string;
    try {
      decodedFileName = decodeURIComponent(fileName);
    } catch {
      throw new DomainError('VALIDATION_ERROR', 'The import filename is invalid.', 400);
    }
    return success(
      reply,
      request,
      await imports().service.inspectBuffer(id, decodedFileName, request.body),
      201,
    );
  });

  app.get('/api/imports/:id/tables', async (request, reply) => {
    const { id } = parsed(importSessionParamsSchema, request.params);
    await authorizedImportSession(request, id);
    return success(reply, request, imports().store.tables(id));
  });

  app.patch('/api/imports/:id/tables/:tableId', async (request, reply) => {
    const { id, tableId } = parsed(importTableParamsSchema, request.params);
    await authorizedImportSession(request, id);
    return success(
      reply,
      request,
      imports().service.updateTable(id, tableId, parsed(updateImportTableSchema, request.body)),
    );
  });

  app.post('/api/imports/:id/reinspect', async (request, reply) => {
    const { id } = parsed(importSessionParamsSchema, request.params);
    await authorizedImportSession(request, id);
    const input = parsed(reinspectImportSessionSchema, request.body);
    return success(reply, request, imports().service.reinspect(id, input.expectedSessionRevision));
  });

  app.get('/api/imports/:id/rows', async (request, reply) => {
    const { id } = parsed(importSessionParamsSchema, request.params);
    await authorizedImportSession(request, id);
    return success(
      reply,
      request,
      imports().store.rows(id, parsed(importRowsQuerySchema, request.query)),
    );
  });

  app.get('/api/imports/:id/rows/:rowId', async (request, reply) => {
    const { id, rowId } = parsed(importRowParamsSchema, request.params);
    await authorizedImportSession(request, id);
    return success(reply, request, imports().store.row(id, rowId));
  });

  app.post('/api/imports/:id/reconcile', async (request, reply) => {
    const { id } = parsed(importSessionParamsSchema, request.params);
    await authorizedImportOwner(request, id);
    const session = imports().store.get(id);
    const reconciliationService =
      session.destinationMode === 'MASTER_LIBRARY'
        ? importLibraryReconciliationService
        : importReconciliationService;
    if (!reconciliationService)
      throw new DomainError('CONFLICT', 'Import reconciliation requires schema v25.', 409);
    return success(
      reply,
      request,
      reconciliationService.reconcile(id, parsed(reconcileImportSessionSchema, request.body)),
    );
  });

  app.patch('/api/imports/:id/rows/:rowId/action', async (request, reply) => {
    const { id, rowId } = parsed(importRowParamsSchema, request.params);
    await authorizedImportOwner(request, id);
    const session = imports().store.get(id);
    const reconciliationService =
      session.destinationMode === 'MASTER_LIBRARY'
        ? importLibraryReconciliationService
        : importReconciliationService;
    if (!reconciliationService)
      throw new DomainError('CONFLICT', 'Import reconciliation requires schema v25.', 409);
    return success(
      reply,
      request,
      reconciliationService.setAction(id, rowId, parsed(updateImportRowActionSchema, request.body)),
    );
  });

  app.patch('/api/imports/:id/rows/actions', async (request, reply) => {
    const { id } = parsed(importSessionParamsSchema, request.params);
    await authorizedImportOwner(request, id);
    const session = imports().store.get(id);
    const reconciliationService =
      session.destinationMode === 'MASTER_LIBRARY'
        ? importLibraryReconciliationService
        : importReconciliationService;
    if (!reconciliationService)
      throw new DomainError('CONFLICT', 'Import reconciliation requires schema v25.', 409);
    return success(
      reply,
      request,
      reconciliationService.setBulkActions(
        id,
        parsed(bulkUpdateImportRowActionsSchema, request.body),
      ),
    );
  });

  app.patch('/api/imports/:id/library-groups', async (request, reply) => {
    const { id } = parsed(importSessionParamsSchema, request.params);
    await authorizedImportOwner(request, id);
    if (!importLibraryReconciliationService)
      throw new DomainError('CONFLICT', 'Library reconciliation requires schema v25.', 409);
    return success(
      reply,
      request,
      importLibraryReconciliationService.decideGroup(
        id,
        parsed(importLibraryGroupDecisionSchema, request.body),
      ),
    );
  });

  app.post('/api/imports/:id/apply', async (request, reply) => {
    const { id } = parsed(importSessionParamsSchema, request.params);
    const { current } = await authorizedImportOwner(request, id);
    if (!importApplyService)
      throw new DomainError('CONFLICT', 'Verified Import Apply authority is unavailable.', 409);
    return success(
      reply,
      request,
      await importApplyService.apply(id, parsed(applyImportSessionSchema, request.body), current),
      202,
    );
  });

  app.get('/api/imports/:id/apply-attempts', async (request, reply) => {
    const { id } = parsed(importSessionParamsSchema, request.params);
    await authorizedImportSession(request, id);
    if (!importApplyService) return success(reply, request, []);
    return success(reply, request, importApplyService.listAttempts(id));
  });

  app.get('/api/imports/:id/apply-attempts/:attemptId', async (request, reply) => {
    const { id, attemptId } = parsed(importApplyAttemptParamsSchema, request.params);
    await authorizedImportSession(request, id);
    if (!importApplyService)
      throw new DomainError('CONFLICT', 'Project Apply authority is unavailable.', 409);
    return success(reply, request, importApplyService.getAttempt(id, attemptId));
  });

  const requireDocumentOwner = async (request: FastifyRequest): Promise<AppUser> => {
    const current = await actor(request);
    assertPermission(
      options.config.WORKSPACE_VARIANT === 'personal' && canManageSettings(current),
      'Only the Personal workspace owner can review document intelligence.',
    );
    return current;
  };

  const authorizedDocument = async (request: FastifyRequest, documentId: string) => {
    const current = await requireDocumentOwner(request);
    const document = documents().store.getDocument(documentId);
    if (document.confirmedProjectId) {
      await service.getProject(current, document.confirmedProjectId);
    }
    return { current, document };
  };

  app.post('/api/documents/admissions', async (request, reply) => {
    const current = await requireDocumentOwner(request);
    const input = parsed(createDocumentAdmissionSchema, request.body);
    if (input.projectContextId) await service.getProject(current, input.projectContextId);
    const admissionId = randomUUID();
    const inboxPath = documents().admission.prepareDesktopInbox(admissionId);
    const handoff = desktopHandoffs.create({
      action: 'SELECT_DOCUMENT_PDF',
      admissionId,
      inboxPath,
      allowedExtensions: ['.pdf'],
    });
    return success(reply, request, { admissionId, handoff }, 201);
  });

  app.post('/api/documents/admissions/:admissionId/complete', async (request, reply) => {
    const { admissionId } = parsed(documentAdmissionParamsSchema, request.params);
    const current = await requireDocumentOwner(request);
    const input = parsed(completeDocumentAdmissionSchema, request.body);
    if (input.projectContextId) await service.getProject(current, input.projectContextId);
    const bytes = documents().admission.admitDesktopSelection(admissionId);
    const result = documents().store.createAdmission({
      bytes,
      admissionMechanism: input.projectContextId ? 'PROJECT_SELECT' : 'GLOBAL_SELECT',
      projectContextId: input.projectContextId ?? null,
      idempotencyKey: input.idempotencyKey,
    });
    documents().coordinator.notifyQueued();
    return success(reply, request, result, 202);
  });

  app.post('/api/documents/artifact-admissions', async (request, reply) => {
    const current = await requireDocumentOwner(request);
    const input = parsed(admitArtifactVersionSchema, request.body);
    if (!managedArtifactStore)
      throw new DomainError('CONFLICT', 'Managed Artifact authority is unavailable.', 409);
    const version = managedArtifactStore.getArtifactVersion(input.artifactVersionId);
    const artifact = managedArtifactStore.getManagedArtifact(version.artifactId);
    if (input.projectContextId && input.projectContextId !== artifact.projectId)
      throw new DomainError('VALIDATION_ERROR', 'Artifact and Project context do not match.', 400);
    await service.getProject(current, artifact.projectId);
    if (!version.sizeBytes || !version.locatorValue.toLocaleLowerCase('en').endsWith('.pdf'))
      throw new DomainError(
        'VALIDATION_ERROR',
        'Only immutable Phase 4 PDF Artifact Versions can be admitted.',
        400,
      );
    const result = documents().store.createArtifactAdmission({
      artifactVersionId: version.versionId,
      projectId: artifact.projectId,
      sha256: version.contentHash,
      sizeBytes: version.sizeBytes,
      originalFileName: path.posix.basename(version.locatorValue),
      idempotencyKey: input.idempotencyKey,
    });
    documents().coordinator.notifyQueued();
    return success(reply, request, result, 202);
  });

  app.post('/api/documents/source', { bodyLimit: 52 * 1024 * 1024 }, async (request, reply) => {
    const current = await requireDocumentOwner(request);
    const fileName = request.headers['x-document-file-name'];
    const idempotencyKey = request.headers['x-document-idempotency-key'];
    const projectContextId = request.headers['x-document-project-id'];
    if (
      typeof fileName !== 'string' ||
      typeof idempotencyKey !== 'string' ||
      (projectContextId !== undefined && typeof projectContextId !== 'string') ||
      !Buffer.isBuffer(request.body)
    ) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'A bounded PDF, filename, and idempotency key are required.',
        400,
      );
    }
    if (projectContextId) await service.getProject(current, projectContextId);
    let decodedFileName: string;
    try {
      decodedFileName = decodeURIComponent(fileName);
    } catch {
      throw new DomainError('VALIDATION_ERROR', 'The document filename is invalid.', 400);
    }
    const bytes = documents().admission.admitBuffer(request.body, decodedFileName);
    const result = documents().store.createAdmission({
      bytes,
      admissionMechanism: projectContextId ? 'PROJECT_SELECT' : 'GLOBAL_SELECT',
      projectContextId: projectContextId ?? null,
      idempotencyKey,
    });
    documents().coordinator.notifyQueued();
    return success(reply, request, result, 202);
  });

  app.get('/api/documents', async (request, reply) => {
    const current = await requireDocumentOwner(request);
    const query = parsed(documentListQuerySchema, request.query);
    if (query.projectId) await service.getProject(current, query.projectId);
    return success(reply, request, documents().store.list(query));
  });

  app.get('/api/documents/:documentId', async (request, reply) => {
    const { documentId } = parsed(documentParamsSchema, request.params);
    return success(reply, request, (await authorizedDocument(request, documentId)).document);
  });

  app.get('/api/documents/:documentId/versions', async (request, reply) => {
    const { documentId } = parsed(documentParamsSchema, request.params);
    await authorizedDocument(request, documentId);
    return success(reply, request, documents().store.versions(documentId));
  });

  app.get('/api/documents/:documentId/processing', async (request, reply) => {
    const { documentId } = parsed(documentParamsSchema, request.params);
    await authorizedDocument(request, documentId);
    return success(reply, request, documents().store.activeAttempt(documentId));
  });

  app.get('/api/documents/:documentId/processing/:attemptId', async (request, reply) => {
    const { documentId, attemptId } = parsed(processingAttemptParamsSchema, request.params);
    await authorizedDocument(request, documentId);
    const attempt = documents().store.attempt(attemptId);
    if (
      !documents()
        .store.versions(documentId)
        .some((version) => version.id === attempt.versionId)
    ) {
      throw new DomainError('NOT_FOUND', 'Processing attempt was not found.', 404);
    }
    return success(reply, request, attempt);
  });

  app.post('/api/documents/:documentId/retry', async (request, reply) => {
    const { documentId } = parsed(documentParamsSchema, request.params);
    const { current } = await authorizedDocument(request, documentId);
    const input = parsed(retryDocumentProcessingSchema, request.body);
    const attempt = documents().store.retry(
      documentId,
      input.expectedRowVersion,
      input.idempotencyKey,
      { id: current.id, name: current.displayName },
    );
    documents().coordinator.notifyQueued();
    return success(reply, request, attempt, 202);
  });

  app.post('/api/documents/:documentId/cancel', async (request, reply) => {
    const { documentId } = parsed(documentParamsSchema, request.params);
    const { current } = await authorizedDocument(request, documentId);
    const input = parsed(cancelDocumentProcessingSchema, request.body);
    return success(
      reply,
      request,
      documents().store.requestCancel(documentId, input.expectedRowVersion, {
        id: current.id,
        name: current.displayName,
      }),
      202,
    );
  });

  app.post('/api/documents/:documentId/manual-ocr', async (request, reply) => {
    const { documentId } = parsed(documentParamsSchema, request.params);
    await authorizedDocument(request, documentId);
    const input = parsed(manualOcrSchema, request.body);
    const attempt = documents().store.requestManualOcr(
      documentId,
      input.expectedRowVersion,
      input.pageNumbers,
    );
    documents().coordinator.notifyQueued();
    return success(reply, request, attempt, 202);
  });

  app.get('/api/documents/:documentId/evidence', async (request, reply) => {
    const { documentId } = parsed(documentParamsSchema, request.params);
    const { document } = await authorizedDocument(request, documentId);
    const query = parsed(documentEvidenceQuerySchema, request.query);
    return success(
      reply,
      request,
      documents().store.evidence(document.activeVersionId, query.page, query.limit),
    );
  });

  app.get('/api/documents/:documentId/association-evidence', async (request, reply) => {
    const { documentId } = parsed(documentParamsSchema, request.params);
    await authorizedDocument(request, documentId);
    return success(reply, request, documents().store.associationEvidence(documentId));
  });

  app.get('/api/documents/:documentId/preview', async (request, reply) => {
    const { documentId } = parsed(documentParamsSchema, request.params);
    await authorizedDocument(request, documentId);
    const query = parsed(documentPreviewQuerySchema, request.query);
    return success(reply, request, await documents().preview.page(documentId, query.pageNumber));
  });

  app.get('/api/documents/:documentId/findings', async (request, reply) => {
    const { documentId } = parsed(documentParamsSchema, request.params);
    await authorizedDocument(request, documentId);
    return success(reply, request, documents().store.findings(documentId));
  });

  app.get('/api/documents/:documentId/relationships', async (request, reply) => {
    const { documentId } = parsed(documentParamsSchema, request.params);
    await authorizedDocument(request, documentId);
    return success(reply, request, documents().store.relationships(documentId));
  });

  app.get('/api/documents/:documentId/decisions', async (request, reply) => {
    const { documentId } = parsed(documentParamsSchema, request.params);
    await authorizedDocument(request, documentId);
    return success(reply, request, documents().store.decisions(documentId));
  });

  app.post('/api/documents/:documentId/decisions', async (request, reply) => {
    const { documentId } = parsed(documentParamsSchema, request.params);
    const { current } = await authorizedDocument(request, documentId);
    return success(
      reply,
      request,
      documents().review.decide(documentId, parsed(ownerDocumentDecisionSchema, request.body), {
        id: current.id,
        name: current.displayName,
      }),
    );
  });

  app.post('/api/documents/consistency/recompute', async (request, reply) => {
    const current = await requireDocumentOwner(request);
    const input = parsed(recomputeConsistencySchema, request.body);
    await service.getProject(current, input.projectId);
    if (!documentConsistencyService)
      throw new DomainError('CONFLICT', 'Document consistency authority is unavailable.', 409);
    return success(reply, request, documentConsistencyService.recompute(input.projectId), 202);
  });

  app.get('/api/documents/:documentId/routing-proposals', async (request, reply) => {
    const { documentId } = parsed(documentParamsSchema, request.params);
    await authorizedDocument(request, documentId);
    if (!documentRoutingService)
      throw new DomainError('CONFLICT', 'Document routing authority is unavailable.', 409);
    return success(reply, request, documentRoutingService.list(documentId));
  });

  app.post('/api/documents/:documentId/routing-proposals', async (request, reply) => {
    const { documentId } = parsed(documentParamsSchema, request.params);
    await authorizedDocument(request, documentId);
    if (!documentRoutingService)
      throw new DomainError('CONFLICT', 'Document routing authority is unavailable.', 409);
    const input = parsed(createRoutingProposalSchema, request.body);
    return success(
      reply,
      request,
      await documentRoutingService.create(
        documentId,
        input.expectedRowVersion,
        input.destinationMappingId,
      ),
      201,
    );
  });

  app.post(
    '/api/documents/:documentId/routing-proposals/:proposalId/approve',
    async (request, reply) => {
      const { documentId, proposalId } = parsed(documentRoutingParamsSchema, request.params);
      const { current } = await authorizedDocument(request, documentId);
      if (!documentRoutingService)
        throw new DomainError('CONFLICT', 'Document routing authority is unavailable.', 409);
      const input = parsed(approveRoutingProposalSchema, request.body);
      return success(
        reply,
        request,
        await documentRoutingService.approve(
          documentId,
          proposalId,
          input.expectedRowVersion,
          input.expectedEligibilityFingerprint,
          input.reason,
          { id: current.id, name: current.displayName },
        ),
      );
    },
  );

  app.post(
    '/api/documents/:documentId/routing-proposals/:proposalId/execute',
    async (request, reply) => {
      const { documentId, proposalId } = parsed(documentRoutingParamsSchema, request.params);
      await authorizedDocument(request, documentId);
      if (!documentRoutingService)
        throw new DomainError('CONFLICT', 'Document routing authority is unavailable.', 409);
      const input = parsed(executeRoutingProposalSchema, request.body);
      return success(
        reply,
        request,
        await documentRoutingService.execute(documentId, proposalId, input.expectedRowVersion),
        202,
      );
    },
  );

  const requireLuminaireLibraryManager = async (request: FastifyRequest): Promise<AppUser> => {
    const current = await actor(request);
    assertPermission(
      options.config.WORKSPACE_VARIANT === 'personal' && canManageSettings(current),
      'Only the Personal workspace owner can manage the Master Luminaire Library.',
    );
    return current;
  };

  app.get('/api/luminaire-library/manufacturers', async (request, reply) => {
    await actor(request);
    return success(
      reply,
      request,
      library().store.listManufacturers(
        parsed(luminaireManufacturerListQuerySchema, request.query),
      ),
    );
  });
  app.post('/api/luminaire-library/manufacturers', async (request, reply) => {
    const current = await requireLuminaireLibraryManager(request);
    return success(
      reply,
      request,
      library().store.createManufacturer(
        parsed(createLuminaireManufacturerSchema, request.body),
        current,
      ),
      201,
    );
  });
  app.patch('/api/luminaire-library/manufacturers/:manufacturerId', async (request, reply) => {
    const current = await requireLuminaireLibraryManager(request);
    const { manufacturerId } = parsed(luminaireLibraryManufacturerParamsSchema, request.params);
    return success(
      reply,
      request,
      library().store.updateManufacturer(
        manufacturerId,
        parsed(updateLuminaireManufacturerSchema, request.body),
        current,
      ),
    );
  });
  app.post(
    '/api/luminaire-library/manufacturers/:manufacturerId/archive',
    async (request, reply) => {
      const current = await requireLuminaireLibraryManager(request);
      const { manufacturerId } = parsed(luminaireLibraryManufacturerParamsSchema, request.params);
      const input = parsed(archiveLuminaireLibraryEntitySchema, request.body);
      return success(
        reply,
        request,
        library().store.archive(
          'MANUFACTURER',
          manufacturerId,
          input.expectedRowVersion,
          input.idempotencyKey,
          current,
        ),
      );
    },
  );
  app.get('/api/luminaire-library/products', async (request, reply) => {
    await actor(request);
    return success(
      reply,
      request,
      library().store.listProducts(parsed(luminaireLibraryListQuerySchema, request.query)),
    );
  });
  app.post('/api/luminaire-library/products', async (request, reply) => {
    const current = await requireLuminaireLibraryManager(request);
    return success(
      reply,
      request,
      library().store.createProduct(
        parsed(createLuminaireLibraryProductSchema, request.body),
        current,
      ),
      201,
    );
  });
  app.get('/api/luminaire-library/products/:productId', async (request, reply) => {
    await actor(request);
    const { productId } = parsed(luminaireLibraryProductParamsSchema, request.params);
    return success(reply, request, library().store.getProductProjection(productId, true));
  });
  app.patch('/api/luminaire-library/products/:productId/draft', async (request, reply) => {
    const current = await requireLuminaireLibraryManager(request);
    const { productId } = parsed(luminaireLibraryProductParamsSchema, request.params);
    return success(
      reply,
      request,
      library().store.updateProduct(
        productId,
        parsed(updateLuminaireLibraryProductDraftSchema, request.body),
        current,
      ),
    );
  });
  app.post('/api/luminaire-library/products/:productId/archive', async (request, reply) => {
    const current = await requireLuminaireLibraryManager(request);
    const { productId } = parsed(luminaireLibraryProductParamsSchema, request.params);
    const input = parsed(archiveLuminaireLibraryEntitySchema, request.body);
    return success(
      reply,
      request,
      library().store.archive(
        'PRODUCT',
        productId,
        input.expectedRowVersion,
        input.idempotencyKey,
        current,
      ),
    );
  });
  app.post('/api/luminaire-library/products/:productId/variants', async (request, reply) => {
    const current = await requireLuminaireLibraryManager(request);
    const { productId } = parsed(luminaireLibraryProductParamsSchema, request.params);
    return success(
      reply,
      request,
      library().store.createVariant(
        productId,
        parsed(createLuminaireLibraryVariantSchema, request.body),
        current,
      ),
      201,
    );
  });
  app.patch('/api/luminaire-library/variants/:variantId/draft', async (request, reply) => {
    const current = await requireLuminaireLibraryManager(request);
    const { variantId } = parsed(luminaireLibraryVariantParamsSchema, request.params);
    return success(
      reply,
      request,
      library().store.updateVariant(
        variantId,
        parsed(updateLuminaireLibraryVariantDraftSchema, request.body),
        current,
      ),
    );
  });
  app.post('/api/luminaire-library/variants/:variantId/publish', async (request, reply) => {
    const current = await requireLuminaireLibraryManager(request);
    const { variantId } = parsed(luminaireLibraryVariantParamsSchema, request.params);
    return success(
      reply,
      request,
      library().store.publishVariant(
        variantId,
        parsed(publishLuminaireLibraryVariantSchema, request.body),
        current,
      ),
    );
  });
  app.post('/api/luminaire-library/variants/:variantId/archive', async (request, reply) => {
    const current = await requireLuminaireLibraryManager(request);
    const { variantId } = parsed(luminaireLibraryVariantParamsSchema, request.params);
    const input = parsed(archiveLuminaireLibraryEntitySchema, request.body);
    return success(
      reply,
      request,
      library().store.archive(
        'VARIANT',
        variantId,
        input.expectedRowVersion,
        input.idempotencyKey,
        current,
      ),
    );
  });
  app.get('/api/luminaire-library/variants/:variantId/versions', async (request, reply) => {
    await actor(request);
    const { variantId } = parsed(luminaireLibraryVariantParamsSchema, request.params);
    return success(reply, request, library().store.listVersions(variantId));
  });
  app.post('/api/luminaire-library/assets', async (request, reply) => {
    const current = await requireLuminaireLibraryManager(request);
    return success(
      reply,
      request,
      library().store.createAsset(parsed(createLuminaireLibraryAssetSchema, request.body), current),
      201,
    );
  });
  app.post('/api/luminaire-library/assets/:assetId/versions', async (request, reply) => {
    const current = await requireLuminaireLibraryManager(request);
    const { assetId } = parsed(luminaireLibraryAssetParamsSchema, request.params);
    return success(
      reply,
      request,
      await library().service.admitAssetVersion(
        assetId,
        parsed(createLuminaireLibraryAssetVersionSchema, request.body),
        current,
      ),
      201,
    );
  });
  app.get(
    '/api/luminaire-library/assets/versions/:assetVersionId/content',
    async (request, reply) => {
      await requireLuminaireLibraryManager(request);
      const { assetVersionId } = parsed(luminaireLibraryAssetVersionParamsSchema, request.params);
      const content = await library().service.assetContent(assetVersionId, dataRoot);
      const bytes = content.bytes;
      reply.header('content-type', content.mimeType);
      reply.header('cache-control', 'private, max-age=31536000, immutable');
      reply.header('etag', `"${content.contentHash}"`);
      return reply.send(bytes);
    },
  );
  app.post(
    '/api/luminaire-library/assets/versions/:assetVersionId/file-handoff',
    async (request, reply) => {
      await requireLuminaireLibraryManager(request);
      const { assetVersionId } = parsed(luminaireLibraryAssetVersionParamsSchema, request.params);
      parsed(z.object({}).strict(), request.body ?? {});
      const content = await library().service.assetContent(assetVersionId, dataRoot);
      return success(
        reply,
        request,
        desktopHandoffs.create({
          action: 'OPEN_LIBRARY_ASSET',
          assetVersionId,
          managed: true,
          authorizedProjectRoot: content.root,
          targetPath: content.canonical,
          fileHash: content.contentHash,
          fileName: content.fileName,
        }),
      );
    },
  );
  app.get('/api/luminaire-library/duplicate-suggestions', async (request, reply) => {
    await actor(request);
    return success(
      reply,
      request,
      library().store.duplicateSuggestions(
        parsed(duplicateLuminaireLibraryQuerySchema, request.query),
      ),
    );
  });

  app.get(
    '/api/projects/:projectId/luminaires/:luminaireId/library-draft-candidate',
    async (request, reply) => {
      const current = await requireLuminaireLibraryManager(request);
      const params = parsed(projectLuminaireLibraryParamsSchema, request.params);
      await service.getProject(current, params.projectId);
      return success(
        reply,
        request,
        library().service.draftCandidate(params.projectId, params.luminaireId),
      );
    },
  );
  app.post(
    '/api/projects/:projectId/luminaires/:luminaireId/create-library-draft',
    async (request, reply) => {
      const current = await requireLuminaireLibraryManager(request);
      const params = parsed(projectLuminaireLibraryParamsSchema, request.params);
      await service.getProject(current, params.projectId);
      return success(
        reply,
        request,
        await library().service.createDraftFromProjectLuminaire(
          params.projectId,
          params.luminaireId,
          parsed(createProjectLuminaireLibraryDraftSchema, request.body),
          current,
        ),
        201,
      );
    },
  );

  app.post('/api/projects/:projectId/luminaires/from-library', async (request, reply) => {
    const current = await actor(request);
    const { projectId } = parsed(projectLuminaireLibraryCreateParamsSchema, request.params);
    await service.getProject(current, projectId);
    return success(
      reply,
      request,
      await library().service.addProjectLuminaire(
        projectId,
        parsed(addProjectLuminaireFromLibrarySchema, request.body),
        current,
      ),
      201,
    );
  });
  app.get(
    '/api/projects/:projectId/luminaires/:luminaireId/library-status',
    async (request, reply) => {
      const current = await actor(request);
      const params = parsed(projectLuminaireLibraryParamsSchema, request.params);
      await service.getProject(current, params.projectId);
      return success(
        reply,
        request,
        library().service.status(params.projectId, params.luminaireId),
      );
    },
  );
  app.get(
    '/api/projects/:projectId/luminaires/:luminaireId/library-compare',
    async (request, reply) => {
      const current = await actor(request);
      const params = parsed(projectLuminaireLibraryParamsSchema, request.params);
      await service.getProject(current, params.projectId);
      const query = parsed(compareProjectLuminaireLibrarySchema, request.query);
      return success(
        reply,
        request,
        library().service.compare(params.projectId, params.luminaireId, query.targetVersionId),
      );
    },
  );
  app.post(
    '/api/projects/:projectId/luminaires/:luminaireId/update-from-library',
    async (request, reply) => {
      const current = await actor(request);
      const params = parsed(projectLuminaireLibraryParamsSchema, request.params);
      await service.getProject(current, params.projectId);
      return success(
        reply,
        request,
        await library().service.updateProjectLuminaire(
          params.projectId,
          params.luminaireId,
          parsed(updateProjectLuminaireFromLibrarySchema, request.body),
          current,
        ),
      );
    },
  );
  app.patch(
    '/api/projects/:projectId/luminaires/:luminaireId/library-description',
    async (request, reply) => {
      const current = await actor(request);
      const params = parsed(projectLuminaireLibraryParamsSchema, request.params);
      await service.getProject(current, params.projectId);
      return success(
        reply,
        request,
        library().service.updateDescriptionOverride(
          params.projectId,
          params.luminaireId,
          parsed(updateProjectLuminaireDescriptionOverrideSchema, request.body),
          current,
        ),
      );
    },
  );

  app.get('/api/personal/settings', async (request, reply) => {
    await actor(request);
    return success(reply, request, personalStore.getSettings());
  });

  const requirePersonalCatalogManager = async (request: FastifyRequest): Promise<void> => {
    const current = await actor(request);
    if (options.config.WORKSPACE_VARIANT !== 'personal') {
      throw new DomainError('NOT_FOUND', 'Route not found.', 404);
    }
    assertPermission(
      canManageSettings(current),
      'Only the local workspace owner can manage action categories.',
    );
  };

  app.get('/api/action-categories', async (request, reply) => {
    await requirePersonalCatalogManager(request);
    return success(reply, request, personalStore.operations.listActionCategories());
  });
  app.post('/api/action-categories', async (request, reply) => {
    await requirePersonalCatalogManager(request);
    return success(
      reply,
      request,
      personalStore.operations.createActionCategory(
        parsed(createActionCategorySchema, request.body),
      ),
      201,
    );
  });
  app.patch('/api/action-categories/:categoryId', async (request, reply) => {
    await requirePersonalCatalogManager(request);
    const { categoryId } = request.params as { categoryId: string };
    return success(
      reply,
      request,
      personalStore.operations.updateActionCategory(
        categoryId,
        parsed(updateActionCategorySchema, request.body),
      ),
    );
  });
  app.delete('/api/action-categories/:categoryId', async (request, reply) => {
    await requirePersonalCatalogManager(request);
    const { categoryId } = request.params as { categoryId: string };
    const input = parsed(
      z.object({ replacementId: z.string().uuid().nullable().optional() }).strict(),
      request.body ?? {},
    );
    personalStore.operations.deleteActionCategory(categoryId, input.replacementId ?? null);
    return success(reply, request, { deleted: true });
  });

  app.patch('/api/personal/settings', async (request, reply) => {
    await actor(request);
    const input = parsed(personalSettingsSchema, request.body);
    return success(reply, request, personalStore.updateSettings(input));
  });

  app.get('/api/personal/project-directory', async (request, reply) => {
    await requirePersonalCatalogManager(request);
    return success(
      reply,
      request,
      new ProjectDirectoryStore(personalStore.getSharedDatabase(), options.clock).list(),
    );
  });
  app.post('/api/personal/project-directory', async (request, reply) => {
    const current = await actor(request);
    await requirePersonalCatalogManager(request);
    return success(
      reply,
      request,
      new ProjectDirectoryStore(personalStore.getSharedDatabase(), options.clock).add(
        current.id,
        parsed(projectDirectoryInputSchema, request.body),
      ),
      201,
    );
  });

  app.get('/api/personal/project-wizard-draft', async (request, reply) => {
    await requirePersonalCatalogManager(request);
    const current = await actor(request);
    return success(
      reply,
      request,
      new ProjectWizardDraftStore(personalStore.getSharedDatabase(), options.clock).read(
        current.id,
      ),
    );
  });
  app.put('/api/personal/project-wizard-draft', async (request, reply) => {
    await requirePersonalCatalogManager(request);
    const current = await actor(request);
    return success(
      reply,
      request,
      new ProjectWizardDraftStore(personalStore.getSharedDatabase(), options.clock).save(
        current.id,
        parsed(projectWizardDraftSchema, request.body),
      ),
    );
  });
  app.delete('/api/personal/project-wizard-draft', async (request, reply) => {
    await requirePersonalCatalogManager(request);
    const current = await actor(request);
    new ProjectWizardDraftStore(personalStore.getSharedDatabase(), options.clock).remove(
      current.id,
    );
    return success(reply, request, { deleted: true });
  });
  app.get('/api/personal/profile', async (request, reply) => {
    await requirePersonalCatalogManager(request);
    const current = await actor(request);
    const stored = new PersonalProfileStore(personalStore.getSharedDatabase(), options.clock).read(
      current.id,
    );
    return success(
      reply,
      request,
      stored ?? { name: current.displayName, email: current.email, photo: null },
    );
  });

  app.post('/api/imports/:id/cancel-selection', async (request, reply) => {
    const { id } = parsed(importSessionParamsSchema, request.params);
    await authorizedImportSession(request, id);
    return success(reply, request, imports().store.cancelEmptySelection(id));
  });
  app.patch('/api/personal/profile', { bodyLimit: 450_000 }, async (request, reply) => {
    await requirePersonalCatalogManager(request);
    const current = await actor(request);
    const profile = new PersonalProfileStore(personalStore.getSharedDatabase(), options.clock).save(
      current.id,
      parsed(personalProfileSchema, request.body),
    );
    return success(reply, request, profile);
  });
  app.get('/api/personal/ui-preferences', async (request, reply) => {
    const current = await actor(request);
    if (options.config.WORKSPACE_VARIANT !== 'personal')
      throw new DomainError('PERMISSION_DENIED', 'Personal workspace required.', 403);
    return success(
      reply,
      request,
      new FinalUiPreferenceStore(personalStore.getSharedDatabase()).read(current.id),
    );
  });
  app.patch('/api/personal/ui-preferences', async (request, reply) => {
    const current = await actor(request);
    if (options.config.WORKSPACE_VARIANT !== 'personal')
      throw new DomainError('PERMISSION_DENIED', 'Personal workspace required.', 403);
    const input = parsed(updateFinalUiPreferenceSchema, request.body);
    if (input.kind === 'PROJECT') await service.getProject(current, input.targetId);
    else if (input.kind === 'LIBRARY_VARIANT') library().store.getVariant(input.targetId);
    else library().store.getProductProjection(input.targetId, true);
    return success(
      reply,
      request,
      new FinalUiPreferenceStore(personalStore.getSharedDatabase()).update(current.id, input),
    );
  });

  // ---------------------------------------------------------------------------
  // P2.9A — Personal project-type catalogue
  //
  // The Personal workspace manages the SAME canonical AppSettings.projectTypes
  // catalogue that Team Admin manages (one canonical source, no second Personal
  // storage model). These routes are Personal-scoped: they require an
  // authenticated local workspace owner (canManageSettings) and are gated to the
  // Personal workspace variant, so they never weaken global Team/Admin
  // authorization. Deactivation is expressed as isActive=false and never
  // rewrites existing Project.projectType metadata.
  // ---------------------------------------------------------------------------

  app.get('/api/personal/project-types', async (request, reply) => {
    await actor(request);
    if (options.config.WORKSPACE_VARIANT !== 'personal') {
      throw new DomainError('NOT_FOUND', 'Route not found.', 404);
    }
    const settings = await options.provider.getSettings();
    return success(reply, request, settings.projectTypes);
  });

  app.patch('/api/personal/project-types', async (request, reply) => {
    const current = await actor(request);
    if (options.config.WORKSPACE_VARIANT !== 'personal') {
      throw new DomainError('NOT_FOUND', 'Route not found.', 404);
    }
    assertPermission(
      canManageSettings(current),
      'Only the local workspace owner can edit project types.',
    );
    const input = parsed(personalProjectTypesSchema, request.body);
    const settings = await options.provider.getSettings();
    const next: AppSettings = {
      ...settings,
      projectTypes: input,
      updatedAt: new Date().toISOString(),
      updatedById: current.id,
    };
    await options.provider.updateSettings(next);
    return success(reply, request, next.projectTypes);
  });

  // ---------------------------------------------------------------------------
  // Phase 4A — durable external-tool context foundation.
  //
  // These routes own UUID-bound context lifecycle only. They do not expose a
  // watcher, arbitrary filesystem path, file-routing operation, or renderer
  // command execution. Active contexts are expired at API restart and require
  // an explicit rebind after their immutable Revision/Document snapshots are
  // revalidated.
  // ---------------------------------------------------------------------------

  const requireAutomationContexts = () => {
    if (options.config.WORKSPACE_VARIANT !== 'personal' || !automationContextService) {
      throw new DomainError('NOT_FOUND', 'Route not found.', 404);
    }
    return automationContextService;
  };

  app.get('/api/personal/projects/:projectId/automation-contexts', async (request, reply) => {
    const current = await actor(request);
    const params = parsed(automationProjectParamsSchema, request.params);
    await service.getProject(current, params.projectId);
    return success(reply, request, requireAutomationContexts().list(params.projectId));
  });

  const requireToolSessions = () => {
    if (!toolSessionWorkflowService) throw new DomainError('NOT_FOUND', 'Route not found.', 404);
    return toolSessionWorkflowService;
  };

  app.get('/api/personal/projects/:projectId/tool-sessions', async (request, reply) => {
    const current = await actor(request);
    const params = parsed(automationProjectParamsSchema, request.params);
    await service.getProject(current, params.projectId);
    return success(reply, request, requireToolSessions().list(params.projectId));
  });

  app.post('/api/personal/projects/:projectId/tool-sessions', async (request, reply) => {
    const current = await actor(request);
    const params = parsed(automationProjectParamsSchema, request.params);
    const input = parsed(startToolSessionSchema, request.body);
    await service.getProject(current, params.projectId);
    const result = await requireToolSessions().start(params.projectId, input);
    captureInboxCoordinator?.activate(
      requireAutomationContexts().get(result.toolSession.toolContextId),
    );
    return success(reply, request, result, result.reusedExisting ? 200 : 201);
  });

  app.post('/api/personal/tool-sessions/:toolContextId/restart', async (request, reply) => {
    const current = await actor(request);
    const params = parsed(automationContextParamsSchema, request.params);
    const existing = requireAutomationContexts().get(params.toolContextId);
    await service.getProject(current, existing.projectId);
    const result = await requireToolSessions().restart(params.toolContextId);
    captureInboxCoordinator?.activate(requireAutomationContexts().get(params.toolContextId));
    return success(reply, request, result);
  });

  app.post(
    '/api/personal/tool-sessions/:toolContextId/export-folder-handoff',
    async (request, reply) => {
      const current = await actor(request);
      const params = parsed(automationContextParamsSchema, request.params);
      const existing = requireAutomationContexts().get(params.toolContextId);
      await service.getProject(current, existing.projectId);
      return success(
        reply,
        request,
        await requireToolSessions().exportFolderHandoff(params.toolContextId),
      );
    },
  );

  app.post('/api/personal/integrations/test-launch-handoff', async (request, reply) => {
    await actor(request);
    const input = parsed(testIntegrationLaunchSchema, request.body);
    return success(reply, request, requireToolSessions().testLaunch(input.application));
  });

  app.post('/api/personal/projects/:projectId/manual-capture-contexts', async (request, reply) => {
    const current = await actor(request);
    const params = parsed(automationProjectParamsSchema, request.params);
    const input = parsed(createManualCaptureContextSchema, request.body);
    await service.getProject(current, params.projectId);
    if (!manualCaptureService) throw new DomainError('NOT_FOUND', 'Route not found.', 404);
    const result = await manualCaptureService.create(params.projectId, input, current);
    captureInboxCoordinator?.activate(
      requireAutomationContexts().get(result.toolSession.toolContextId),
    );
    return success(reply, request, result, 201);
  });

  app.post('/api/personal/projects/:projectId/automation-contexts', async (request, reply) => {
    const current = await actor(request);
    const params = parsed(automationProjectParamsSchema, request.params);
    const input = parsed(openAutomationContextSchema, request.body);
    await service.getProject(current, params.projectId);
    const context = requireAutomationContexts().open({
      projectId: params.projectId,
      application: input.application,
      expectedArtifactType: input.expectedArtifactType,
      targetRevisionId: input.targetRevisionId,
      sourceDocumentId: input.sourceDocumentId,
    });
    captureInboxCoordinator?.activate(context);
    return success(reply, request, context, 201);
  });

  for (const action of ['expire', 'rebind', 'close'] as const) {
    app.post(
      `/api/personal/automation-contexts/:toolContextId/${action}`,
      async (request, reply) => {
        const current = await actor(request);
        const params = parsed(automationContextParamsSchema, request.params);
        const contexts = requireAutomationContexts();
        const existing = contexts.get(params.toolContextId);
        await service.getProject(current, existing.projectId);
        const result = contexts[action](params.toolContextId);
        if (action === 'rebind') captureInboxCoordinator?.activate(result);
        else captureInboxCoordinator?.deactivate(result.toolContextId);
        return success(reply, request, result);
      },
    );
  }

  const requireCaptureBackend = () => {
    if (!captureReadService || !captureRoutingCoordinator) {
      throw new DomainError('NOT_FOUND', 'Route not found.', 404);
    }
    return { read: captureReadService, routing: captureRoutingCoordinator };
  };

  app.get('/api/personal/projects/:projectId/captures', async (request, reply) => {
    const current = await actor(request);
    const params = parsed(automationProjectParamsSchema, request.params);
    const query = parsed(captureListQuerySchema, request.query);
    await service.getProject(current, params.projectId);
    return success(
      reply,
      request,
      await requireCaptureBackend().read.list(params.projectId, query),
    );
  });

  app.get('/api/personal/captures/:captureId', async (request, reply) => {
    const current = await actor(request);
    const params = parsed(captureParamsSchema, request.params);
    const backend = requireCaptureBackend();
    await service.getProject(current, backend.read.getOwningProjectId(params.captureId));
    return success(reply, request, await backend.read.get(params.captureId));
  });

  app.post('/api/personal/captures/:captureId/retry', async (request, reply) => {
    const current = await actor(request);
    const params = parsed(captureParamsSchema, request.params);
    parsed(emptyCaptureRetrySchema, request.body ?? {});
    const backend = requireCaptureBackend();
    await service.getProject(current, backend.read.getOwningProjectId(params.captureId));
    const capture = await backend.routing.retry(params.captureId);
    return success(reply, request, await backend.read.get(capture.captureId));
  });

  app.post('/api/personal/captures/:captureId/discard', async (request, reply) => {
    const current = await actor(request);
    const params = parsed(captureParamsSchema, request.params);
    const input = parsed(discardCaptureSchema, request.body);
    const backend = requireCaptureBackend();
    await service.getProject(current, backend.read.getOwningProjectId(params.captureId));
    if (!captureDispositionService) throw new DomainError('NOT_FOUND', 'Route not found.', 404);
    captureDispositionService.discard(params.captureId, input, current);
    return success(reply, request, await backend.read.get(params.captureId));
  });

  app.post('/api/personal/captures/:captureId/file-handoff', async (request, reply) => {
    const current = await actor(request);
    const params = parsed(captureParamsSchema, request.params);
    const input = parsed(fileHandoffInputSchema, request.body);
    const backend = requireCaptureBackend();
    await service.getProject(current, backend.read.getOwningProjectId(params.captureId));
    if (!captureDispositionService) throw new DomainError('NOT_FOUND', 'Route not found.', 404);
    return success(
      reply,
      request,
      await captureDispositionService.fileHandoff(params.captureId, input),
    );
  });

  app.post(
    '/api/personal/projects/:projectId/documents/:documentId/file-handoff',
    async (request, reply) => {
      const current = await actor(request);
      const params = parsed(projectDocumentFileHandoffParamsSchema, request.params);
      const input = parsed(fileHandoffInputSchema, request.body);
      await service.getProject(current, params.projectId);
      if (!captureDispositionService) throw new DomainError('NOT_FOUND', 'Route not found.', 404);
      return success(
        reply,
        request,
        await captureDispositionService.projectDocumentFileHandoff(
          params.projectId,
          params.documentId,
          input,
        ),
      );
    },
  );

  app.patch(
    '/api/personal/projects/:projectId/output-mappings/:outputTypeId',
    async (request, reply) => {
      const current = await actor(request);
      const params = parsed(outputMappingParamsSchema, request.params);
      const input = parsed(updateOutputMappingSchema, request.body);
      await service.getProject(current, params.projectId);
      return success(
        reply,
        request,
        projectOutputMappingService.update(params.projectId, params.outputTypeId, input),
      );
    },
  );

  // ---------------------------------------------------------------------------
  // P2.8A — Personal WorkSession routes
  //
  // These are the Personal timer lifecycle endpoints. They are a separate
  // durable structured-row model and deliberately do NOT expose the Team
  // TimeTrackingService. Starting/stopping/switching a WorkSession never
  // changes project.status and never appends ordinary ProjectActivity rows.
  // The coordinator is only wired when the provider and store share one
  // connection (production startup); otherwise these routes are unavailable.
  // ---------------------------------------------------------------------------

  app.get('/api/personal/work-sessions/active', async (request, reply) => {
    await actor(request);
    if (!personalWorkSessionCoordinator) {
      throw new DomainError('NOT_FOUND', 'Route not found.', 404);
    }
    return success(reply, request, personalWorkSessionCoordinator.getActive());
  });

  app.get('/api/personal/projects/:projectId/work-sessions', async (request, reply) => {
    await actor(request);
    if (!personalWorkSessionCoordinator) {
      throw new DomainError('NOT_FOUND', 'Route not found.', 404);
    }
    const params = parsed(workSessionParamsSchema, request.params);
    return success(reply, request, personalWorkSessionCoordinator.listForProject(params.projectId));
  });

  app.post('/api/personal/work-sessions/start', async (request, reply) => {
    const current = await actor(request);
    if (!personalWorkSessionCoordinator) {
      throw new DomainError('NOT_FOUND', 'Route not found.', 404);
    }
    const input = parsed(startWorkSessionSchema, request.body);
    await service.getProject(current, input.projectId);
    const result = await personalWorkSessionCoordinator.start({
      attribution: { actorId: current.id, actorName: current.displayName },
      projectId: input.projectId,
      now: new Date().toISOString(),
      idempotencyKey: input.idempotencyKey,
    });
    return success(reply, request, result, result.replayed ? 200 : 201);
  });

  app.post('/api/personal/work-sessions/stop', async (request, reply) => {
    await actor(request);
    if (!personalWorkSessionCoordinator) {
      throw new DomainError('NOT_FOUND', 'Route not found.', 404);
    }
    const input = parsed(stopWorkSessionSchema, request.body);
    const result = await personalWorkSessionCoordinator.stop({
      now: new Date().toISOString(),
      idempotencyKey: input.idempotencyKey,
    });
    return success(reply, request, result);
  });

  app.post('/api/personal/work-sessions/switch', async (request, reply) => {
    const current = await actor(request);
    if (!personalWorkSessionCoordinator) {
      throw new DomainError('NOT_FOUND', 'Route not found.', 404);
    }
    const input = parsed(switchWorkSessionSchema, request.body);
    await service.getProject(current, input.targetProjectId);
    const result = await personalWorkSessionCoordinator.switchTo({
      attribution: { actorId: current.id, actorName: current.displayName },
      targetProjectId: input.targetProjectId,
      now: new Date().toISOString(),
      idempotencyKey: input.idempotencyKey,
    });
    return success(reply, request, result);
  });

  app.post('/api/personal/work-sessions/pause', async (request, reply) => {
    await actor(request);
    if (!personalWorkSessionCoordinator) {
      throw new DomainError('NOT_FOUND', 'Route not found.', 404);
    }
    const input = parsed(pauseWorkSessionSchema, request.body);
    const result = await personalWorkSessionCoordinator.pause({
      now: new Date().toISOString(),
      idempotencyKey: input.idempotencyKey,
    });
    return success(reply, request, result);
  });

  app.post('/api/personal/work-sessions/resume', async (request, reply) => {
    await actor(request);
    if (!personalWorkSessionCoordinator) {
      throw new DomainError('NOT_FOUND', 'Route not found.', 404);
    }
    const input = parsed(resumeWorkSessionSchema, request.body);
    const result = await personalWorkSessionCoordinator.resume({
      now: new Date().toISOString(),
      idempotencyKey: input.idempotencyKey,
    });
    return success(reply, request, result);
  });

  app.get('/api/folder-profiles', async (request, reply) => {
    await actor(request);
    return success(reply, request, personalStore.listFolderProfiles());
  });

  app.post('/api/folder-profiles', async (request, reply) => {
    await actor(request);
    const input = parsed(saveFolderProfileSchema, request.body);
    return success(reply, request, personalStore.saveFolderProfile(input), 201);
  });

  app.get('/api/folder-profiles/catalog', async (request, reply) => {
    await actor(request);
    const catalog = folderProfileService.getCatalog();
    const compatibility = folderProfileService.resolveDefaultCompatibility();
    return success(reply, request, {
      ...folderProfileCatalogView(catalog),
      effectiveDefaultRef: compatibility.effectiveRef,
      legacyDefaultFolderProfile: compatibility.legacyName,
      legacyDefaultMatch: compatibility.legacyMatch,
      legacyImportRequired: compatibility.requiresImport,
    });
  });

  app.get('/api/folder-profiles/catalog/:profileId', async (request, reply) => {
    await actor(request);
    const { profileId } = parsed(folderProfileParamsSchema, request.params);
    return success(reply, request, folderProfileService.getProfile(profileId));
  });

  app.post('/api/folder-profiles/catalog', async (request, reply) => {
    await actor(request);
    const input = parsed(createFolderProfileSchema, request.body);
    return success(reply, request, folderProfileService.createProfile(input), 201);
  });

  app.patch('/api/folder-profiles/catalog/:profileId', async (request, reply) => {
    await actor(request);
    const { profileId } = parsed(folderProfileParamsSchema, request.params);
    const input = parsed(updateFolderProfileSchema, request.body);
    return success(reply, request, folderProfileService.updateProfile(profileId, input));
  });

  app.post('/api/folder-profiles/catalog/:profileId/duplicate', async (request, reply) => {
    await actor(request);
    const { profileId } = parsed(folderProfileParamsSchema, request.params);
    return success(reply, request, folderProfileService.duplicateProfile(profileId), 201);
  });

  app.delete('/api/folder-profiles/catalog/:profileId', async (request, reply) => {
    await actor(request);
    const { profileId } = parsed(folderProfileParamsSchema, request.params);
    folderProfileService.deleteProfile(profileId);
    return success(reply, request, { deleted: true });
  });

  app.put('/api/folder-profiles/catalog/default', async (request, reply) => {
    await actor(request);
    const input = parsed(setDefaultFolderProfileSchema, request.body);
    const ref: FolderProfileRef =
      'kind' in input ? input : { kind: 'user', profileId: input.profileId };
    return success(
      reply,
      request,
      folderProfileCatalogView(folderProfileService.setDefaultProfileRef(ref)),
    );
  });

  app.delete('/api/folder-profiles/catalog/default', async (request, reply) => {
    await actor(request);
    return success(
      reply,
      request,
      folderProfileCatalogView(folderProfileService.clearDefaultProfile()),
    );
  });

  app.post('/api/folder-profiles/catalog/import', async (request, reply) => {
    await actor(request);
    const input = parsed(importFolderProfileSchema, request.body);
    return success(reply, request, folderProfileService.importLegacyProfile(input.name), 201);
  });

  app.post('/api/personal/backup', async (request, reply) => {
    await actor(request);
    const backupPath = options.workspaceBackupService
      ? await options.workspaceBackupService.createBackup()
      : personalStore.createBackup();
    return success(reply, request, { backupPath }, 201);
  });

  app.get('/api/personal/backups', async (request, reply) => {
    await actor(request);
    return success(
      reply,
      request,
      options.workspaceBackupService
        ? await options.workspaceBackupService.listBackups()
        : personalStore.listBackups(),
    );
  });

  app.post('/api/personal/backups/restore', async (request, reply) => {
    await actor(request);
    const input = parsed(scheduleRestoreSchema, request.body);
    return success(
      reply,
      request,
      {
        pendingPath: options.workspaceBackupService
          ? await options.workspaceBackupService.scheduleRestore(input.backupPath)
          : personalStore.scheduleRestore(input.backupPath),
        restartRequired: true,
      },
      202,
    );
  });

  app.get('/api/personal/operations', async (request, reply) => {
    const current = await actor(request);
    const allowed = new Set((await service.listProjects(current, {})).map((project) => project.id));
    const operations = personalStore.operations.portfolioOperations();
    return success(reply, request, {
      overdueActions: operations.overdueActions.filter((item) => allowed.has(item.projectId)),
      upcomingActions: operations.upcomingActions.filter((item) => allowed.has(item.projectId)),
      upcomingMeetings: operations.upcomingMeetings.filter((item) => allowed.has(item.projectId)),
      blockingRequirements: operations.blockingRequirements.filter((item) =>
        allowed.has(item.projectId),
      ),
      openReviews: operations.openReviews.filter((item) => allowed.has(item.projectId)),
    });
  });

  app.get('/api/personal/reports/activity', async (request, reply) => {
    const current = await actor(request);
    const input = parsed(periodActivityReportQuerySchema, request.query);
    return success(reply, request, await createPersonalPeriodReport(current, input));
  });

  app.get('/api/personal/reports/activity.xlsx', async (request, reply) => {
    const current = await actor(request);
    const input = parsed(periodActivityReportQuerySchema, request.query);
    const report = await createPersonalPeriodReport(current, input);
    const workbook = await buildPeriodReportWorkbook(report);
    return reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header(
        'content-disposition',
        `attachment; filename="SCT_Activity_${input.from}_${input.to}.xlsx"`,
      )
      .send(workbook);
  });

  app.get('/api/personal/search', async (request, reply) => {
    const current = await actor(request);
    const input = parsed(workspaceSearchSchema, request.query);
    const projects = await service.listProjects(current, {});
    const results = personalStore.operations.search(input.q, projects);
    const normalized = input.q.trim().toLowerCase();
    if (normalized) {
      const histories = await Promise.all(
        projects.map((project) => options.provider.listActivities(project.id)),
      );
      const historicalProjectIds = new Set<string>();
      projects.forEach((project, index) => {
        const matches = (histories[index] ?? []).some(
          (activity) =>
            activity.fieldName === 'projectCode' &&
            ((activity.oldValue ?? '').toLowerCase().includes(normalized) ||
              (activity.newValue ?? '').toLowerCase().includes(normalized)),
        );
        if (matches) historicalProjectIds.add(project.id);
      });
      const existingProjectIds = new Set(
        results.filter((result) => result.type === 'Project').map((result) => result.projectId),
      );
      for (const project of projects) {
        if (!historicalProjectIds.has(project.id) || existingProjectIds.has(project.id)) continue;
        results.push({
          id: project.id,
          projectId: project.id,
          type: 'Project',
          title: project.projectName,
          detail: `${project.projectCode} · ${project.clientName}`,
          date: project.updatedAt,
        });
      }
      results.sort((a, b) => b.date.localeCompare(a.date));
      results.splice(120);
    }
    return success(reply, request, results);
  });

  app.get('/api/users', async (request, reply) => {
    const current = await actor(request);
    const users = await options.provider.listUsers();
    return success(
      reply,
      request,
      isManager(current) ? users : users.filter((user) => user.id === current.id),
    );
  });

  app.get('/api/users/sales', async (request, reply) => {
    const current = await actor(request);
    assertPermission(isManager(current), 'Only Line Managers and Admins can select Sales users.');
    const users = (await options.provider.listUsers()).filter(
      (user) => user.role === 'Sales' && user.isActive,
    );
    return success(reply, request, users);
  });

  app.post('/api/personal/sales', async (request, reply) => {
    const current = await actor(request);
    if (options.config.WORKSPACE_VARIANT !== 'personal') {
      throw new DomainError('NOT_FOUND', 'Route not found.', 404);
    }
    assertPermission(canManageSettings(current), 'Only the local workspace owner can edit Sales.');
    const input = parsed(personalSalesContactSchema, request.body);
    const existing = (await options.provider.listUsers()).find(
      (entry) =>
        entry.role === 'Sales' &&
        entry.isActive &&
        (entry.displayName.trim().toLowerCase().replace(/\s+/g, ' ') ===
          input.displayName.trim().toLowerCase().replace(/\s+/g, ' ') ||
          (input.email && entry.email.toLowerCase() === input.email.toLowerCase())),
    );
    if (existing) return success(reply, request, existing);

    const now = new Date().toISOString();
    const id = randomUUID();
    const email = input.email?.toLowerCase() ?? `sales.${id.slice(0, 8)}@scli.local`;
    const created = await options.provider.createUser({
      id,
      entraObjectId: `local-sales:${id}`,
      displayName: input.displayName,
      email,
      jobTitle: 'Sales Contact',
      department: 'Sales',
      role: 'Sales',
      weeklyCapacityHours: 0,
      availabilityStatus: 'Available',
      avatarUrl: null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    return success(reply, request, created, 201);
  });

  app.get('/api/project-types', async (request, reply) => {
    await actor(request);
    const settings = await options.provider.getSettings();
    return success(
      reply,
      request,
      settings.projectTypes.filter((projectType) => projectType.isActive),
    );
  });

  // Edit surfaces need the full canonical catalogue to distinguish a current
  // inactive snapshot from a historical value that is no longer configured.
  // Selectable targets are still filtered client-side and revalidated by the
  // authoritative ProjectService update boundary.
  app.get('/api/project-types/catalog', async (request, reply) => {
    await actor(request);
    const settings = await options.provider.getSettings();
    return success(reply, request, settings.projectTypes);
  });

  app.patch('/api/admin/users/:id', async (request, reply) => {
    const current = await actor(request);
    assertPermission(canManageSettings(current), 'Only Admins can manage users.');
    const input = parsed(updateUserSchema, request.body);
    const userId = (request.params as { id: string }).id;
    const target = await options.provider.getUser(userId);
    if (!target) throw new DomainError('NOT_FOUND', 'User not found.', 404);
    const nextRole = input.role ?? target.role;
    const nextActive = input.isActive ?? target.isActive;
    if (target.role === 'Admin' && target.isActive && (nextRole !== 'Admin' || !nextActive)) {
      const hasAnotherAdmin = (await options.provider.listUsers()).some(
        (user) => user.id !== target.id && user.role === 'Admin' && user.isActive,
      );
      if (!hasAnotherAdmin) {
        throw new DomainError(
          'VALIDATION_ERROR',
          'Create another active Admin before changing the final Admin account.',
          400,
        );
      }
    }
    const userPatch: Partial<AppUser> = { updatedAt: new Date().toISOString() };
    if (input.displayName !== undefined) userPatch.displayName = input.displayName;
    if (input.email !== undefined) userPatch.email = input.email.toLowerCase();
    if (input.jobTitle !== undefined) userPatch.jobTitle = input.jobTitle;
    if (input.department !== undefined) userPatch.department = input.department;
    if (input.role !== undefined) userPatch.role = input.role;
    if (input.weeklyCapacityHours !== undefined) {
      userPatch.weeklyCapacityHours = input.weeklyCapacityHours;
    }
    if (input.availabilityStatus !== undefined) {
      userPatch.availabilityStatus = input.availabilityStatus;
    }
    if (nextRole !== 'Designer') {
      userPatch.weeklyCapacityHours = 0;
      userPatch.availabilityStatus = 'Available';
    }
    if (input.isActive !== undefined) {
      if (current.id === userId && !input.isActive) {
        throw new DomainError('VALIDATION_ERROR', 'You cannot deactivate your own account.', 400);
      }
      userPatch.isActive = input.isActive;
    }
    const updated = await options.provider.updateUser(userId, userPatch);
    return success(reply, request, updated);
  });

  app.post('/api/admin/users', async (request, reply) => {
    const current = await actor(request);
    assertPermission(canManageSettings(current), 'Only Admins can create users.');
    if (options.config.APP_MODE !== 'standalone' || !supportsLocalIdentity(options.provider)) {
      throw new DomainError(
        'CONFIGURATION_REQUIRED',
        'Create Microsoft 365 users through the approved identity provisioning process.',
        409,
      );
    }
    const input = parsed(createUserSchema, request.body);
    if (!input.initialPassword) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'An initial password of at least 12 characters is required.',
        400,
      );
    }
    const now = new Date().toISOString();
    const id = randomUUID();
    const created = await options.provider.createUser({
      id,
      entraObjectId: `standalone:${id}`,
      displayName: input.displayName,
      email: input.email.toLowerCase(),
      jobTitle: input.jobTitle,
      department: input.department,
      role: input.role,
      weeklyCapacityHours: input.role === 'Designer' ? input.weeklyCapacityHours : 0,
      availabilityStatus: input.role === 'Designer' ? input.availabilityStatus : 'Available',
      avatarUrl: null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    try {
      await options.provider.setPassword(created.id, input.initialPassword);
    } catch (error) {
      await options.provider.updateUser(created.id, { isActive: false, updatedAt: now });
      throw error;
    }
    return success(reply, request, created, 201);
  });

  app.post('/api/admin/users/:id/password', async (request, reply) => {
    const current = await actor(request);
    assertPermission(canManageSettings(current), 'Only Admins can reset passwords.');
    if (options.config.APP_MODE !== 'standalone' || !supportsLocalIdentity(options.provider)) {
      throw new DomainError('NOT_FOUND', 'Local password management is not available.', 404);
    }
    const input = parsed(resetPasswordSchema, request.body);
    await options.provider.setPassword((request.params as { id: string }).id, input.password);
    return success(reply, request, { reset: true });
  });

  app.get('/api/designers/workload', async (request, reply) =>
    success(reply, request, await service.workloads(await actor(request))),
  );

  app.get('/api/time-tracking/overview', async (request, reply) =>
    success(reply, request, await timeTrackingService.overview(await actor(request))),
  );

  app.get('/api/timesheets', async (request, reply) => {
    const input = parsed(timesheetQuerySchema, request.query);
    return success(
      reply,
      request,
      await timeTrackingService.listTimesheets(await actor(request), input),
    );
  });

  app.get('/api/projects/:id/timesheets', async (request, reply) => {
    const params = parsed(routeIdSchema, request.params);
    return success(
      reply,
      request,
      await timeTrackingService.listProjectTimesheets(await actor(request), params.id),
    );
  });

  app.post('/api/projects/:id/time-entries/start', async (request, reply) => {
    const params = parsed(routeIdSchema, request.params);
    const input = parsed(startTimeEntrySchema, request.body);
    return success(
      reply,
      request,
      await timeTrackingService.start(await actor(request), params.id, input),
      201,
    );
  });

  app.post('/api/projects/:id/time-entries/:entryId/pause', async (request, reply) => {
    const params = parsed(projectEntryParamsSchema, request.params);
    return success(
      reply,
      request,
      await timeTrackingService.pause(await actor(request), params.id, params.entryId),
    );
  });

  app.post('/api/projects/:id/time-entries/:entryId/resume', async (request, reply) => {
    const params = parsed(projectEntryParamsSchema, request.params);
    return success(
      reply,
      request,
      await timeTrackingService.resume(await actor(request), params.id, params.entryId),
    );
  });

  app.post('/api/projects/:id/time-entries/:entryId/stop', async (request, reply) => {
    const params = parsed(projectEntryParamsSchema, request.params);
    return success(
      reply,
      request,
      await timeTrackingService.stop(await actor(request), params.id, params.entryId),
    );
  });

  app.patch('/api/projects/:id/time-entries/:entryId', async (request, reply) => {
    const params = parsed(projectEntryParamsSchema, request.params);
    const input = parsed(correctTimeEntrySchema, request.body);
    return success(
      reply,
      request,
      await timeTrackingService.correct(await actor(request), params.id, params.entryId, input),
    );
  });

  app.post('/api/projects/:id/timesheets/submit', async (request, reply) => {
    const params = parsed(routeIdSchema, request.params);
    return success(
      reply,
      request,
      await timeTrackingService.submit(await actor(request), params.id),
    );
  });

  app.post('/api/projects/:id/timesheets/:userId/approve', async (request, reply) => {
    const params = parsed(projectUserParamsSchema, request.params);
    const input = parsed(reviewTimesheetSchema, request.body ?? {});
    return success(
      reply,
      request,
      await timeTrackingService.review(
        await actor(request),
        params.id,
        params.userId,
        'approve',
        input.reason,
      ),
    );
  });

  app.post('/api/projects/:id/timesheets/:userId/reject', async (request, reply) => {
    const params = parsed(projectUserParamsSchema, request.params);
    const input = parsed(reviewTimesheetSchema, request.body ?? {});
    return success(
      reply,
      request,
      await timeTrackingService.review(
        await actor(request),
        params.id,
        params.userId,
        'reject',
        input.reason,
      ),
    );
  });

  app.get('/api/projects', async (request, reply) => {
    const input = parsed(projectQuerySchema, request.query);
    return success(
      reply,
      request,
      await service.listProjects(await actor(request), queryFromInput(input)),
    );
  });

  app.get('/api/projects/:id', async (request, reply) =>
    success(
      reply,
      request,
      await service.getProject(await actor(request), (request.params as { id: string }).id),
    ),
  );

  app.post('/api/projects', async (request, reply) => {
    const input = parsed(createProjectSchema, request.body);
    if (input.folderDraft) {
      validateProjectFolderDraft(input.folderDraft);
    }
    const current = await actor(request);
    const result = await service.createProject(current, input);
    if (options.config.WORKSPACE_VARIANT !== 'personal') {
      return success(reply, request, result, 201);
    }
    let workspace = input.folderDraft
      ? personalStore.initializeCanonicalProject(
          result.project.id,
          input.folderDraft,
          input.folderProfile,
          input.services,
          input.luminaireInputMode,
          input.requiredDeliveryDate,
          input.scopeItems,
        )
      : personalStore.initializeProject(
          result.project.id,
          input.services,
          input.folderProfile,
          input.luminaireInputMode,
          input.requiredDeliveryDate,
          input.folderStructure,
          input.outputFolders,
          input.scopeItems,
        );
    result.workflow.push({
      key: 'workspace',
      label: 'Preparing lighting deliverables',
      completedAt: new Date().toISOString(),
    });
    let folderCreation: ReturnType<ProjectFolderService['create']> | null = null;
    let folderError: string | null = null;
    if (input.connectFolderPath) {
      try {
        const connected = await projectStorageService.reconnect(result.project, {
          candidatePath: input.connectFolderPath,
          intent: input.storageConnectIntent ?? 'INITIAL_BINDING',
          expectedVersion: result.project.version,
        });
        result.project = connected.project;
        workspace = personalStore.getWorkspace(result.project.id);
        result.workflow.push({
          key: 'folders',
          label: 'Connecting existing project folder',
          completedAt: new Date().toISOString(),
        });
      } catch (error) {
        folderError =
          error instanceof Error ? error.message : 'Existing folder could not be connected.';
      }
    } else if (input.createFolders) {
      try {
        if (result.project.projectFolderPath) {
          // Idempotent retry: the physical tree was already created from the
          // persisted canonical snapshot; reuse the durable recorded state.
          workspace = personalStore.getWorkspace(result.project.id);
          result.workflow.push({
            key: 'folders',
            label: 'Using existing project folders',
            completedAt: new Date().toISOString(),
          });
        } else {
          const settings = personalStore.getSettings();
          const projectRoot = input.projectRoot ?? settings.projectRoot;
          if (input.folderDraft) {
            const persistedWorkspace = personalStore.getWorkspace(result.project.id);
            folderCreation = folderService.createCanonical(
              projectRoot,
              result.project,
              persistedWorkspace.folderSnapshot,
              persistedWorkspace.outputMappings,
            );
            result.project = await projectStorageService.bindProgramOwnedRoot(
              result.project,
              folderCreation.folderPath,
            );
            workspace = personalStore.getWorkspace(result.project.id);
          } else {
            const savedProfile = personalStore
              .listFolderProfiles()
              .find((candidate) => candidate.name === input.folderProfile);
            if (!savedProfile) {
              throw new DomainError('VALIDATION_ERROR', 'Unknown folder profile.', 400);
            }
            const profile = {
              ...savedProfile,
              folders: workspace.folderStructure,
              outputFolders: workspace.outputFolders,
            };
            folderCreation = folderService.create(projectRoot, result.project, profile);
            result.project = await projectStorageService.bindProgramOwnedRoot(
              result.project,
              folderCreation.folderPath,
            );
            workspace = personalStore.getWorkspace(result.project.id);
          }
          result.workflow.push({
            key: 'folders',
            label: 'Creating project folders',
            completedAt: new Date().toISOString(),
          });
        }
      } catch (error) {
        folderError =
          error instanceof Error ? error.message : 'Project folders could not be created.';
      }
    }
    return success(reply, request, { ...result, workspace, folderCreation, folderError }, 201);
  });

  app.post('/api/personal/legacy-projects/preview', async (request, reply) => {
    if (options.config.WORKSPACE_VARIANT !== 'personal') {
      throw new DomainError('NOT_FOUND', 'Legacy project import is personal-workspace only.', 404);
    }
    await actor(request);
    const input = parsed(legacyProjectPreviewSchema, request.body);
    return success(reply, request, await legacyProjectImportService.preview(input.rootPath));
  });

  app.post('/api/personal/legacy-projects/scan-folders', async (request, reply) => {
    if (options.config.WORKSPACE_VARIANT !== 'personal') {
      throw new DomainError('NOT_FOUND', 'Legacy project import is personal-workspace only.', 404);
    }
    await actor(request);
    const input = parsed(legacyProjectFolderScanSchema, request.body);
    return success(reply, request, legacyProjectImportService.scanFolders(input.folderPaths));
  });

  app.post('/api/personal/legacy-projects/import', async (request, reply) => {
    if (options.config.WORKSPACE_VARIANT !== 'personal') {
      throw new DomainError('NOT_FOUND', 'Legacy project import is personal-workspace only.', 404);
    }
    const current = await actor(request);
    const input = parsed(legacyProjectImportSchema, request.body);
    return success(
      reply,
      request,
      await legacyProjectImportService.importProjects(current, input),
      201,
    );
  });

  app.get('/api/projects/:id/file-index', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    await service.getProject(await actor(request), projectId);
    return success(reply, request, personalStore.getFolderIndex(projectId));
  });

  app.post('/api/projects/:id/file-index/scan', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    await service.getProject(await actor(request), projectId);
    return success(reply, request, await legacyProjectImportService.scanProject(projectId));
  });

  app.post('/api/projects/:id/archive', async (request, reply) => {
    if (options.config.WORKSPACE_VARIANT !== 'personal') {
      throw new DomainError('NOT_FOUND', 'Personal project archive is not available.', 404);
    }
    return success(
      reply,
      request,
      await service.archiveProject(await actor(request), (request.params as { id: string }).id),
    );
  });

  app.post('/api/projects/:id/restore', async (request, reply) => {
    if (options.config.WORKSPACE_VARIANT !== 'personal') {
      throw new DomainError('NOT_FOUND', 'Personal project restore is not available.', 404);
    }
    return success(
      reply,
      request,
      await service.restoreProject(await actor(request), (request.params as { id: string }).id),
    );
  });

  app.post('/api/projects/:id/reference', async (request, reply) => {
    if (options.config.WORKSPACE_VARIANT !== 'personal') {
      throw new DomainError(
        'NOT_FOUND',
        'Project reference editing is personal-workspace only.',
        404,
      );
    }
    const projectId = (request.params as { id: string }).id;
    const current = await actor(request);
    const input = parsed(changeProjectReferenceSchema, request.body);
    const prepared = await service.prepareProjectReferenceChange(current, projectId, input);
    if (!prepared.changed) {
      return success(reply, request, {
        project: prepared.project,
        folderRenamed: false,
        recoveryRequired: false,
      });
    }
    const workspace = personalStore.getWorkspace(projectId);
    const oldIndex = personalStore.getFolderIndex(projectId);
    const storedFolder = prepared.project.projectFolderPath ?? null;
    const workspaceFolder = workspace.folderPath;
    if (Boolean(storedFolder) !== Boolean(workspaceFolder)) {
      throw new DomainError(
        'CONFLICT',
        'Project folder ownership is ambiguous. The managed folder mapping is incomplete.',
        409,
      );
    }
    let renameResult: { oldPath: string; newPath: string } | null = null;
    if (storedFolder && workspaceFolder) {
      renameResult = folderService.renameManagedProjectFolder(
        prepared.project,
        workspaceFolder,
        prepared.newCode,
      );
    }
    let index: ProjectFolderIndex | null = null;
    try {
      if (renameResult) {
        index = scanProjectFolder(renameResult.newPath, projectId);
      }
    } catch (error) {
      const compensation = await restoreReferenceAfterFailedRename({
        projectId,
        snapshot: prepared.project,
        renameResult,
        oldIndex,
      });
      if (!compensation.restored) {
        throw recoveryRequiredError(
          prepared.project.projectCode,
          prepared.newCode,
          compensation.failed,
        );
      }
      throw error;
    }
    let committed: Project;
    try {
      committed = await service.commitProjectReferenceChange(current, projectId, {
        previousProject: prepared.project,
        newCode: prepared.newCode,
        newFolderPath: renameResult?.newPath ?? null,
        folderIndexedAt: index?.indexedAt ?? null,
        folderFileCount: index?.fileCount ?? null,
        now: prepared.now,
        ...(input.auditReason ? { auditReason: input.auditReason } : {}),
      });
    } catch (error) {
      const compensation = await restoreReferenceAfterFailedRename({
        projectId,
        snapshot: prepared.project,
        renameResult,
        oldIndex,
      });
      if (!compensation.restored) {
        throw recoveryRequiredError(
          prepared.project.projectCode,
          prepared.newCode,
          compensation.failed,
        );
      }
      throw error;
    }
    try {
      if (renameResult && index) {
        personalStore.setFolderPath(projectId, renameResult.newPath);
        personalStore.replaceFolderIndex(index);
        folderService.updateProjectInfo(committed, renameResult.newPath);
      }
    } catch (error) {
      const compensation = await restoreReferenceAfterFailedRename({
        projectId,
        snapshot: prepared.project,
        renameResult,
        oldIndex,
      });
      if (!compensation.restored) {
        throw recoveryRequiredError(
          prepared.project.projectCode,
          prepared.newCode,
          compensation.failed,
        );
      }
      throw error;
    }
    return success(reply, request, {
      project: committed,
      folderRenamed: renameResult !== null,
      recoveryRequired: false,
    });
  });

  app.delete('/api/projects/:id', async (request, reply) => {
    if (options.config.WORKSPACE_VARIANT !== 'personal') {
      throw new DomainError('NOT_FOUND', 'Personal project removal is not available.', 404);
    }
    const projectId = (request.params as { id: string }).id;
    const input = parsed(removeProjectFromWorkspaceSchema, request.body);
    personalStore.createBackup('PRE_REMOVE_PROJECT');
    const removed = await service.removeProjectFromWorkspace(
      await actor(request),
      projectId,
      input.confirmation,
    );
    personalStore.removeProjectData(projectId);
    return success(reply, request, {
      removed: true,
      projectCode: removed.projectCode,
      folderUntouched: removed.projectFolderPath ?? null,
    });
  });

  app.get('/api/projects/:id/workspace', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    await service.getProject(await actor(request), projectId);
    return success(reply, request, personalStore.getWorkspace(projectId));
  });

  app.get('/api/projects/:id/local-intelligence', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    const project = await service.getProject(await actor(request), projectId);
    const workspace = personalStore.getWorkspace(projectId);
    const folderIndex = personalStore.getFolderIndex(projectId);
    return success(
      reply,
      request,
      await localIntelligenceService.overview(project, workspace, folderIndex),
    );
  });

  app.get('/api/projects/:id/local-intelligence/datasheet-results', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    await service.getProject(await actor(request), projectId);
    if (!luminaireDatasheetVerificationService)
      throw new DomainError('CONFLICT', 'Datasheet verification requires schema v27.', 409);
    return success(
      reply,
      request,
      await luminaireDatasheetVerificationService.readBatch(
        projectId,
        personalStore.getWorkspace(projectId).luminaires,
      ),
    );
  });

  app.post('/api/projects/:id/local-intelligence/analyze-datasheets', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    await service.getProject(await actor(request), projectId);
    const luminaires = personalStore.getWorkspace(projectId).luminaires;
    if (!luminaireDatasheetVerificationService) {
      throw new DomainError('CONFLICT', 'Datasheet verification requires schema v27.', 409);
    }
    return success(
      reply,
      request,
      await luminaireDatasheetVerificationService.verifyBatch(projectId, luminaires),
    );
  });

  app.get('/api/projects/:id/legacy-datasheet-adoption', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    const project = await service.getProject(await actor(request), projectId);
    if (!legacyDatasheetAdoptionService) {
      throw new DomainError('CONFLICT', 'Legacy Datasheet adoption requires schema v27.', 409);
    }
    return success(reply, request, await legacyDatasheetAdoptionService.inspectProject(project));
  });

  app.post('/api/projects/:id/legacy-datasheet-adoption', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    const requestActor = await actor(request);
    const project = await service.getProject(requestActor, projectId);
    if (!isManager(requestActor)) {
      throw new DomainError(
        'PERMISSION_DENIED',
        'Owner authorization is required to adopt legacy Datasheets.',
        403,
      );
    }
    if (!legacyDatasheetAdoptionService) {
      throw new DomainError('CONFLICT', 'Legacy Datasheet adoption requires schema v27.', 409);
    }
    const input = parsed(legacyDatasheetAdoptionSchema, request.body);
    return success(
      reply,
      request,
      await legacyDatasheetAdoptionService.adopt(project, input, requestActor),
    );
  });

  app.post(
    '/api/projects/:id/luminaires/:luminaireId/analyze-datasheet',
    async (request, reply) => {
      const { id, luminaireId } = request.params as { id: string; luminaireId: string };
      await service.getProject(await actor(request), id);
      const luminaire = personalStore
        .getWorkspace(id)
        .luminaires.find((item) => item.id === luminaireId);
      if (!luminaire) throw new DomainError('NOT_FOUND', 'Luminaire was not found.', 404);
      if (!luminaireDatasheetVerificationService) {
        throw new DomainError('CONFLICT', 'Datasheet verification requires schema v27.', 409);
      }
      return success(
        reply,
        request,
        await luminaireDatasheetVerificationService.verify(id, luminaireId),
      );
    },
  );

  app.patch(
    '/api/projects/:id/luminaires/:luminaireId/datasheet-verification/field',
    async (request, reply) => {
      const { id, luminaireId } = request.params as { id: string; luminaireId: string };
      const requestActor = await actor(request);
      await service.getProject(requestActor, id);
      if (!luminaireDatasheetVerificationService) {
        throw new DomainError('CONFLICT', 'Datasheet verification requires schema v27.', 409);
      }
      const input = parsed(resolveLuminaireDatasheetFieldSchema, request.body);
      return success(
        reply,
        request,
        await luminaireDatasheetVerificationService.resolveProjectField({
          projectId: id,
          luminaireId,
          fieldKey: input.fieldKey,
          expectedRowVersion: input.expectedRowVersion,
          verificationFingerprint: input.verificationFingerprint,
          actor: { id: requestActor.id, name: requestActor.displayName },
        }),
      );
    },
  );

  app.post(
    '/api/projects/:id/luminaires/:luminaireId/datasheet-verification/confirm',
    async (request, reply) => {
      const { id, luminaireId } = z
        .object({ id: z.string().uuid(), luminaireId: z.string().uuid() })
        .parse(request.params);
      const requestActor = await actor(request);
      await service.getProject(requestActor, id);
      if (!isManager(requestActor))
        throw new DomainError(
          'PERMISSION_DENIED',
          'Owner or manager authorization is required to confirm Datasheet evidence.',
          403,
        );
      if (!luminaireDatasheetVerificationService)
        throw new DomainError('CONFLICT', 'Datasheet verification is unavailable.', 409);
      const input = parsed(confirmDatasheetFieldSchema, request.body);
      return success(
        reply,
        request,
        await luminaireDatasheetVerificationService.confirmField(id, luminaireId, input, {
          id: requestActor.id,
          name: requestActor.displayName,
        }),
      );
    },
  );

  app.post(
    '/api/projects/:id/luminaires/:luminaireId/datasheet-verification/keep-project-value',
    async (request, reply) => {
      const { id, luminaireId } = parsed(
        z.object({ id: z.uuid(), luminaireId: z.uuid() }).strict(),
        request.params,
      );
      const current = await actor(request);
      await service.getProject(current, id);
      if (!isManager(current))
        throw new DomainError(
          'PERMISSION_DENIED',
          'Owner or manager authorization is required to record a review.',
          403,
        );
      if (!luminaireDatasheetVerificationService)
        throw new DomainError('CONFLICT', 'Datasheet verification is unavailable.', 409);
      return success(
        reply,
        request,
        await luminaireDatasheetVerificationService.keepProjectField(
          id,
          luminaireId,
          parsed(keepProjectFieldSchema, request.body),
          { id: current.id, name: current.displayName },
        ),
      );
    },
  );

  app.get('/api/projects/:id/revision-package-catalog', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    const query = parsed(revisionPackageCatalogQuerySchema, request.query);
    const project = await service.getProject(await actor(request), projectId);
    const workspace = personalStore.getWorkspace(projectId);
    return success(
      reply,
      request,
      await revisionPackageService.catalog(project, workspace, query.revisionId),
    );
  });

  app.post('/api/projects/:id/revision-packages', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    const requestActor = await actor(request);
    const project = await service.getProject(requestActor, projectId);
    const input = parsed(createRevisionPackageSchema, request.body);
    await projectStorageService.resolveVerifiedProjectRoot(project);
    const workspace = personalStore.getWorkspace(projectId);
    return success(
      reply,
      request,
      await revisionPackageService.create(project, workspace, requestActor, input),
      201,
    );
  });

  app.get('/api/projects/:id/revision-packages/compare', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    await service.getProject(await actor(request), projectId);
    const input = parsed(revisionPackageComparisonQuerySchema, request.query);
    return success(
      reply,
      request,
      personalStore.compareRevisionPackages(projectId, input.from, input.to),
    );
  });

  // REV-02A — canonical Issue History read. GET only, no request body, no
  // mutation. Authorization is the standard project gate; the projection is
  // scoped to the authorized project by construction. When the canonical
  // registry is absent (legacy harness) the read fails closed with an empty
  // history — canonical history cannot exist without the registry.
  app.post(
    '/api/projects/:id/issue-packages/:packageId/deliverables/:deliverableId/file-handoff',
    async (request, reply) => {
      const params = parsed(
        z
          .object({
            id: z.string().uuid(),
            packageId: z.string().uuid(),
            deliverableId: z.string().uuid(),
          })
          .strict(),
        request.params,
      );
      parsed(z.object({}).strict(), request.body ?? {});
      const project = await service.getProject(await actor(request), params.id);
      const root = await projectStorageService.resolveVerifiedProjectRoot(project);
      if (!scheduleCanonicalRegistry)
        throw new DomainError('NOT_FOUND', 'Saved packages are unavailable.', 404);
      const file = await new PackageArtifactAccess(scheduleCanonicalRegistry).prepareOpen(
        dataRoot,
        project.id,
        params.packageId,
        root,
        personalStore
          .getWorkspace(project.id)
          .revisionPackages.find((item) => item.id === params.packageId)?.packageHash ?? '',
        params.deliverableId,
      );
      return success(
        reply,
        request,
        desktopHandoffs.create({
          action: 'OPEN_PACKAGE_DELIVERABLE',
          projectId: project.id,
          packageId: params.packageId,
          deliverableId: params.deliverableId,
          managed: true,
          ...file,
        }),
      );
    },
  );

  app.get('/api/projects/:id/issue-packages/:packageId/file', async (request, reply) => {
    const params = parsed(
      z.object({ id: z.string().uuid(), packageId: z.string().uuid() }).strict(),
      request.params,
    );
    const query = parsed(
      z.object({ memberId: z.string().uuid().optional() }).strict(),
      request.query,
    );
    const project = await service.getProject(await actor(request), params.id);
    const root = await projectStorageService.resolveVerifiedProjectRoot(project);
    if (!scheduleCanonicalRegistry)
      throw new DomainError('NOT_FOUND', 'Saved packages are unavailable.', 404);
    const file = await new PackageArtifactAccess(scheduleCanonicalRegistry).read(
      project.id,
      params.packageId,
      root,
      personalStore
        .getWorkspace(project.id)
        .revisionPackages.find((item) => item.id === params.packageId)?.packageHash ?? '',
      query.memberId,
    );
    reply.header('cache-control', 'private, no-store');
    reply.header(
      'content-disposition',
      `${query.memberId ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    );
    return reply
      .type(
        file.fileName.toLowerCase().endsWith('.pdf')
          ? 'application/pdf'
          : file.fileName.toLowerCase().endsWith('.zip')
            ? 'application/zip'
            : 'application/octet-stream',
      )
      .send(file.bytes);
  });

  app.get('/api/projects/:id/issue-history', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    const project = await service.getProject(await actor(request), projectId);
    const items = issueHistoryService ? issueHistoryService.list(project.id) : [];
    return success(reply, request, { items });
  });

  // REV-02A2 — on-demand package reproducibility verification. GET/read-only,
  // no request body, no mutation. Authorization is the standard project gate.
  // The package MUST belong to the authorized project; when it does not, or
  // the canonical registry is absent, the read fails closed.
  app.get('/api/projects/:id/issue-packages/:packageId/verify', async (request, reply) => {
    const { id: projectId, packageId } = request.params as { id: string; packageId: string };
    const project = await service.getProject(await actor(request), projectId);
    if (!packageReproducibilityService) {
      throw new DomainError('NOT_FOUND', 'Issue Package verification is not available.', 404);
    }
    const result = await packageReproducibilityService.verify(project.id, packageId);
    if (!result) {
      throw new DomainError('NOT_FOUND', 'Issue Package not found.', 404);
    }
    return success(reply, request, result);
  });

  app.post('/api/projects/:id/requirements', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    await service.getProject(await actor(request), projectId);
    const input = parsed(projectRequirementSchema, request.body);
    return success(
      reply,
      request,
      personalStore.operations.createRequirement(projectId, input),
      201,
    );
  });

  app.patch('/api/projects/:id/requirements/:itemId', async (request, reply) => {
    const { id: projectId, itemId } = request.params as { id: string; itemId: string };
    await service.getProject(await actor(request), projectId);
    const input = parsed(projectRequirementSchema, request.body);
    return success(
      reply,
      request,
      personalStore.operations.updateRequirement(projectId, itemId, input),
    );
  });

  app.delete('/api/projects/:id/requirements/:itemId', async (request, reply) => {
    const { id: projectId, itemId } = request.params as { id: string; itemId: string };
    await service.getProject(await actor(request), projectId);
    personalStore.operations.deleteRequirement(projectId, itemId);
    return success(reply, request, { deleted: true });
  });

  app.post('/api/projects/:id/tags', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    await service.getProject(await actor(request), projectId);
    return success(
      reply,
      request,
      personalStore.operations.createProjectTag(
        projectId,
        parsed(createProjectTagSchema, request.body),
      ),
      201,
    );
  });
  app.patch('/api/projects/:id/tags/:tagId', async (request, reply) => {
    const { id: projectId, tagId } = request.params as { id: string; tagId: string };
    await service.getProject(await actor(request), projectId);
    return success(
      reply,
      request,
      personalStore.operations.updateProjectTag(
        projectId,
        tagId,
        parsed(updateProjectTagSchema, request.body),
      ),
    );
  });
  app.delete('/api/projects/:id/tags/:tagId', async (request, reply) => {
    const { id: projectId, tagId } = request.params as { id: string; tagId: string };
    await service.getProject(await actor(request), projectId);
    personalStore.operations.deleteProjectTag(projectId, tagId);
    return success(reply, request, { deleted: true });
  });
  app.post('/api/projects/:id/scope-notes', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    await service.getProject(await actor(request), projectId);
    return success(
      reply,
      request,
      personalStore.operations.createScopeNote(
        projectId,
        parsed(createScopeNoteSchema, request.body),
      ),
      201,
    );
  });
  app.patch('/api/projects/:id/scope-notes/:noteId', async (request, reply) => {
    const { id: projectId, noteId } = request.params as { id: string; noteId: string };
    await service.getProject(await actor(request), projectId);
    return success(
      reply,
      request,
      personalStore.operations.updateScopeNote(
        projectId,
        noteId,
        parsed(updateScopeNoteSchema, request.body),
      ),
    );
  });
  app.delete('/api/projects/:id/scope-notes/:noteId', async (request, reply) => {
    const { id: projectId, noteId } = request.params as { id: string; noteId: string };
    await service.getProject(await actor(request), projectId);
    personalStore.operations.deleteScopeNote(projectId, noteId);
    return success(reply, request, { deleted: true });
  });

  app.post('/api/projects/:id/checklist', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    await service.getProject(await actor(request), projectId);
    const input = parsed(projectChecklistItemSchema, request.body);
    return success(
      reply,
      request,
      personalStore.operations.createChecklistItem(projectId, input),
      201,
    );
  });

  app.patch('/api/projects/:id/checklist/:itemId', async (request, reply) => {
    const { id: projectId, itemId } = request.params as { id: string; itemId: string };
    await service.getProject(await actor(request), projectId);
    const input = parsed(projectChecklistItemSchema, request.body);
    return success(
      reply,
      request,
      personalStore.operations.updateChecklistItem(projectId, itemId, input),
    );
  });

  app.post('/api/projects/:id/actions', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    await service.getProject(await actor(request), projectId);
    const input = parsed(projectActionItemSchema, request.body);
    return success(reply, request, personalStore.operations.createAction(projectId, input), 201);
  });

  app.patch('/api/projects/:id/actions/:itemId', async (request, reply) => {
    const { id: projectId, itemId } = request.params as { id: string; itemId: string };
    await service.getProject(await actor(request), projectId);
    const input = parsed(projectActionItemSchema, request.body);
    return success(reply, request, personalStore.operations.updateAction(projectId, itemId, input));
  });

  // ---------------------------------------------------------------------------
  // P5D — Project Intelligence & Productivity
  //
  // Project-scoped, server-authoritative routes. Readiness and Revision
  // Comparison are read-only projections of existing authorities. Action
  // patches use sparse fields + row_version optimistic concurrency. Controlled
  // source files are admitted ONLY through the governed desktop picker; the
  // renderer never supplies a filesystem path for mutation.
  // ---------------------------------------------------------------------------

  app.get('/api/projects/:id/intelligence', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    await service.getProject(await actor(request), projectId);
    const workspace = personalStore.getWorkspace(projectId);
    const revisions = scheduleCanonicalRegistry
      ? scheduleCanonicalRegistry.listRevisions(projectId)
      : [];
    const actions = workspace.actions;
    const sources = projectIntelligenceStore.listSourceFiles(projectId);
    const openBlockingActions = actions.filter((action) =>
      actionBlocksIssue(action.status, action.blocksIssue === true),
    ).length;
    const availableSources = sources.filter((source) => {
      if (!workspace.folderPath) return false;
      try {
        const absolute = path.resolve(workspace.folderPath, source.originalRelativeLocator);
        return existsSync(absolute);
      } catch {
        return false;
      }
    }).length;
    return success(reply, request, {
      projectId,
      checkedAt: new Date().toISOString(),
      readiness: null,
      revisions: revisions.map((revision) => ({
        revisionId: revision.revisionId,
        revisionLabel: revision.revisionLabel,
        lifecycleState: revision.lifecycleState,
        finalizedAt: revision.finalizedAt,
      })),
      actionCounts: {
        open: actions.filter(
          (action) => action.status !== 'Completed' && action.status !== 'Cancelled',
        ).length,
        inProgress: actions.filter((action) => action.status === 'InProgress').length,
        done: actions.filter((action) => action.status === 'Completed').length,
        cancelled: actions.filter((action) => action.status === 'Cancelled').length,
        openBlocking: openBlockingActions,
      },
      sourceCounts: { total: sources.length, available: availableSources },
    });
  });

  app.get('/api/projects/:id/readiness', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    const project = await service.getProject(await actor(request), projectId);
    const input = parsed(readinessQuerySchema, request.query);
    return success(
      reply,
      request,
      await projectIntelligenceService.readiness(project, input.revisionId),
    );
  });

  app.get('/api/projects/:id/revision-comparison', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    const project = await service.getProject(await actor(request), projectId);
    const input = parsed(revisionComparisonQuerySchema, request.query);
    return success(
      reply,
      request,
      projectIntelligenceService.compareRevisions(
        project,
        input.fromRevisionId,
        input.toRevisionId,
      ),
    );
  });

  // Action sparse CAS patch (P5D authority). The legacy full-payload PATCH above
  // remains for compatibility; P5D uses this endpoint with row_version.
  app.patch('/api/projects/:id/actions/:itemId/merge', async (request, reply) => {
    const { id: projectId, itemId } = request.params as { id: string; itemId: string };
    const requestActor = await actor(request);
    await service.getProject(requestActor, projectId);
    const input = parsed(patchProjectActionSchema, request.body);
    const { rowVersion, ...patch } = input;
    return success(
      reply,
      request,
      personalStore.operations.patchAction(projectId, itemId, patch, rowVersion, {
        id: requestActor.id,
        name: requestActor.displayName,
      }),
    );
  });

  app.get('/api/projects/:id/source-files', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    await service.getProject(await actor(request), projectId);
    return success(reply, request, projectIntelligenceStore.listSourceFiles(projectId));
  });

  // Bounded source picker handoff — creates a one-time governed selection the
  // desktop bridge can act on. The renderer receives only an opaque UUID.
  app.post('/api/projects/:id/source-files/select-handoff', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    const project = await service.getProject(await actor(request), projectId);
    const root = await projectStorageService.resolveVerifiedProjectRoot(project);
    const admissionId = randomUUID();
    const inboxPath = path.join(dataRoot, 'project-sources', 'pending', admissionId);
    mkdirSync(inboxPath, { recursive: true });
    const handoff = desktopHandoffs.create({
      action: 'SELECT_PROJECT_SOURCE',
      projectId,
      admissionId,
      inboxPath,
      allowedExtensions: ['.dwg', '.dxf', '.evo', '.dpx', '.xls', '.xlsx'],
      maximumBytes: MAX_CONTROLLED_SOURCE_BYTES,
      authorizedProjectRoot: root,
    });
    return success(reply, request, { admissionId, handoff }, 201);
  });

  // Completes the governed source admission: the server reads the picked file
  // from the handoff inbox, validates it (regular file, no symlink, size
  // bound, extension whitelist), places it under the verified Project root at
  // its basename, fingerprints it, and registers it. The renderer only ever
  // supplies the opaque admissionId + source type — never a path.
  app.post('/api/projects/:id/source-files', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    const project = await service.getProject(await actor(request), projectId);
    const input = parsed(registerProjectSourceFileSchema, request.body);
    const root = await projectStorageService.resolveVerifiedProjectRoot(project);
    const admissionDir = path.join(dataRoot, 'project-sources', 'pending', input.admissionId);
    if (!existsSync(admissionDir)) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'The governed source selection is missing or expired.',
        400,
      );
    }
    const entries = readdirSync(admissionDir).filter((name) => !name.startsWith('.'));
    if (entries.length !== 1) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'A single governed source selection is required.',
        400,
      );
    }
    const picked = path.join(admissionDir, entries[0]!);
    const pickedStats = lstatSync(picked);
    if (!pickedStats.isFile() || pickedStats.isSymbolicLink()) {
      throw new DomainError('VALIDATION_ERROR', 'The selected source is not a regular file.', 400);
    }
    if (pickedStats.size <= 0 || pickedStats.size > MAX_CONTROLLED_SOURCE_BYTES) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'The selected source is empty or exceeds the 200 MiB bound.',
        400,
      );
    }
    // Safe basename only — the server (never the renderer) chooses the governed
    // project-relative location. Duplicate basenames conflict deterministically.
    // Control characters are stripped by a code-point scan (no-control-regex).
    const safeBasename = Array.from(path.basename(picked))
      .map((char) => {
        const code = char.codePointAt(0) ?? 0;
        if (code < 0x20 || /[<>:"/\\|?*]/.test(char)) return '_';
        return char;
      })
      .join('');
    if (!safeBasename.trim() || safeBasename === '.' || safeBasename === '..') {
      throw new DomainError('VALIDATION_ERROR', 'The selected source name is invalid.', 400);
    }
    const originalRelativeLocator = safeBasename;
    const target = path.join(root, originalRelativeLocator);
    if (existsSync(target)) {
      throw new DomainError(
        'CONFLICT',
        'A source file already exists at that governed location.',
        409,
      );
    }
    renameSync(picked, target);
    try {
      const source = await projectIntelligenceService.registerSourceFile(project, {
        sourceType: input.sourceType,
        pickedFileAbsolutePath: target,
      });
      return success(reply, request, source, 201);
    } catch (error) {
      // Registration failed; the governed copy is removed so no orphan file
      // accumulates under the project root.
      rmSync(target, { force: true });
      throw error;
    }
  });

  app.delete('/api/projects/:id/source-files/:sourceId', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    const sourceId = (request.params as { sourceId: string }).sourceId;
    await service.getProject(await actor(request), projectId);
    projectIntelligenceStore.deleteSourceFile(projectId, sourceId);
    return success(reply, request, { deleted: true });
  });

  // On-demand freshness: hashes the registered file and compares against the
  // exact Revision baseline. Read-only apart from last_checked_at refresh.
  app.post('/api/projects/:id/source-files/:sourceId/check', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    const sourceId = (request.params as { sourceId: string }).sourceId;
    const project = await service.getProject(await actor(request), projectId);
    const input = parsed(readinessQuerySchema, request.query);
    const { item, revisionLabel } = await projectIntelligenceService.checkSourceFreshness(
      project,
      sourceId,
      input.revisionId,
    );
    return success(reply, request, { ...item, revisionLabel });
  });

  // Freshness for every registered source against one exact Revision.
  app.get('/api/projects/:id/source-files/freshness', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    const project = await service.getProject(await actor(request), projectId);
    const input = parsed(readinessQuerySchema, request.query);
    const items = await projectIntelligenceService.listSourceFreshness(project, input.revisionId);
    return success(reply, request, items);
  });

  // Capture an immutable source baseline for an exact Revision UUID.
  app.post('/api/projects/:id/revisions/:revisionId/source-baselines', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    const revisionId = (request.params as { revisionId: string }).revisionId;
    const requestActor = await actor(request);
    const project = await service.getProject(requestActor, projectId);
    const input = parsed(captureSourceBaselineSchema, request.body);
    if (input.revisionId !== revisionId) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Revision identity mismatch between the route and the request body.',
        400,
      );
    }
    const revision = scheduleCanonicalRegistry
      ? scheduleCanonicalRegistry.getRevision(revisionId)
      : null;
    if (revision && revision.projectId !== projectId) {
      throw new DomainError('NOT_FOUND', 'Canonical Revision not found.', 404);
    }
    const { baseline, revisionLabel } = projectIntelligenceService.captureSourceBaseline(
      project,
      input.sourceId,
      revisionId,
      requestActor,
      revision?.revisionLabel ?? null,
    );
    return success(reply, request, { baseline, revisionLabel }, 201);
  });

  app.get('/api/projects/:id/revisions/:revisionId/source-baselines', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    const revisionId = (request.params as { revisionId: string }).revisionId;
    await service.getProject(await actor(request), projectId);
    return success(
      reply,
      request,
      projectIntelligenceStore.listBaselinesForRevision(projectId, revisionId),
    );
  });

  app.post('/api/projects/:id/meetings', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    await service.getProject(await actor(request), projectId);
    const input = parsed(projectMeetingSchema, request.body);
    return success(reply, request, personalStore.operations.createMeeting(projectId, input), 201);
  });

  app.patch('/api/projects/:id/meetings/:itemId', async (request, reply) => {
    const { id: projectId, itemId } = request.params as { id: string; itemId: string };
    await service.getProject(await actor(request), projectId);
    const input = parsed(projectMeetingSchema, request.body);
    return success(
      reply,
      request,
      personalStore.operations.updateMeeting(projectId, itemId, input),
    );
  });

  app.get('/api/projects/:id/meetings', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    await service.getProject(await actor(request), projectId);
    return success(reply, request, personalStore.operations.listMeetingReadModels(projectId));
  });
  app.get('/api/projects/:id/meetings/:meetingId', async (request, reply) => {
    const { id: projectId, meetingId } = request.params as { id: string; meetingId: string };
    await service.getProject(await actor(request), projectId);
    return success(reply, request, personalStore.operations.getMeetingDetail(projectId, meetingId));
  });

  app.get('/api/projects/:id/meetings/:meetingId/participants', async (request, reply) => {
    const { id: projectId, meetingId } = request.params as { id: string; meetingId: string };
    await service.getProject(await actor(request), projectId);
    return success(
      reply,
      request,
      personalStore.operations.listMeetingParticipants(projectId, meetingId),
    );
  });
  app.get('/api/projects/:id/meetings/:meetingId/agenda-items', async (request, reply) => {
    const { id: projectId, meetingId } = request.params as { id: string; meetingId: string };
    await service.getProject(await actor(request), projectId);
    return success(
      reply,
      request,
      personalStore.operations.listMeetingAgendaItems(projectId, meetingId),
    );
  });
  app.get('/api/projects/:id/meetings/:meetingId/notes', async (request, reply) => {
    const { id: projectId, meetingId } = request.params as { id: string; meetingId: string };
    await service.getProject(await actor(request), projectId);
    return success(reply, request, personalStore.operations.listMeetingNotes(projectId, meetingId));
  });
  app.post('/api/projects/:id/meetings/:meetingId/notes', async (request, reply) => {
    const { id: projectId, meetingId } = request.params as { id: string; meetingId: string };
    await service.getProject(await actor(request), projectId);
    return success(
      reply,
      request,
      personalStore.operations.createMeetingNote(
        projectId,
        meetingId,
        parsed(meetingNoteInputSchema, request.body),
      ),
      201,
    );
  });
  app.patch('/api/projects/:id/meetings/:meetingId/notes/:noteId', async (request, reply) => {
    const {
      id: projectId,
      meetingId,
      noteId,
    } = request.params as { id: string; meetingId: string; noteId: string };
    await service.getProject(await actor(request), projectId);
    return success(
      reply,
      request,
      personalStore.operations.updateMeetingNote(
        projectId,
        meetingId,
        noteId,
        parsed(meetingNoteInputSchema, request.body),
      ),
    );
  });
  app.delete('/api/projects/:id/meetings/:meetingId/notes/:noteId', async (request, reply) => {
    const {
      id: projectId,
      meetingId,
      noteId,
    } = request.params as { id: string; meetingId: string; noteId: string };
    await service.getProject(await actor(request), projectId);
    personalStore.operations.deleteMeetingNote(projectId, meetingId, noteId);
    return success(reply, request, { deleted: true });
  });
  app.get('/api/projects/:id/meetings/:meetingId/action-links', async (request, reply) => {
    const { id: projectId, meetingId } = request.params as { id: string; meetingId: string };
    await service.getProject(await actor(request), projectId);
    return success(
      reply,
      request,
      personalStore.operations.listMeetingActionLinks(projectId, meetingId),
    );
  });
  app.post('/api/projects/:id/meetings/:meetingId/action-links', async (request, reply) => {
    const { id: projectId, meetingId } = request.params as { id: string; meetingId: string };
    await service.getProject(await actor(request), projectId);
    const { actionId } = parsed(linkMeetingActionSchema, request.body);
    return success(
      reply,
      request,
      personalStore.operations.linkMeetingAction(projectId, meetingId, {
        actionId,
        relationType: 'Linked',
      }),
      201,
    );
  });
  app.delete(
    '/api/projects/:id/meetings/:meetingId/action-links/:actionId',
    async (request, reply) => {
      const {
        id: projectId,
        meetingId,
        actionId,
      } = request.params as { id: string; meetingId: string; actionId: string };
      await service.getProject(await actor(request), projectId);
      personalStore.operations.unlinkMeetingAction(projectId, meetingId, actionId);
      return success(reply, request, { deleted: true });
    },
  );
  app.get('/api/projects/:id/actions/:actionId/meeting-links', async (request, reply) => {
    const { id: projectId, actionId } = request.params as { id: string; actionId: string };
    await service.getProject(await actor(request), projectId);
    return success(
      reply,
      request,
      personalStore.operations.listActionMeetingLinks(projectId, actionId),
    );
  });
  app.post('/api/projects/:id/meetings/:meetingId/actions', async (request, reply) => {
    const { id: projectId, meetingId } = request.params as { id: string; meetingId: string };
    await service.getProject(await actor(request), projectId);
    return success(
      reply,
      request,
      personalStore.operations.createActionFromMeeting(
        projectId,
        meetingId,
        parsed(createActionFromMeetingSchema, request.body),
      ),
      201,
    );
  });

  app.post('/api/projects/:id/review-items', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    await service.getProject(await actor(request), projectId);
    const input = parsed(projectReviewItemSchema, request.body);
    return success(reply, request, personalStore.operations.createReview(projectId, input), 201);
  });

  app.post('/api/projects/:id/review-threads', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    const requestActor = await actor(request);
    await service.getProject(requestActor, projectId);
    const input = parsed(createProjectReviewThreadSchema, request.body);
    return success(
      reply,
      request,
      personalStore.operations.createReviewThread(projectId, input, requestActor),
      201,
    );
  });

  app.patch('/api/projects/:id/review-items/:itemId', async (request, reply) => {
    const { id: projectId, itemId } = request.params as { id: string; itemId: string };
    const requestActor = await actor(request);
    await service.getProject(requestActor, projectId);
    const input = parsed(projectReviewItemSchema, request.body);
    return success(
      reply,
      request,
      personalStore.operations.updateReview(projectId, itemId, input, requestActor),
    );
  });

  app.get('/api/projects/:id/review-thread-context', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    await service.getProject(await actor(request), projectId);
    return success(reply, request, personalStore.operations.listReviewThreadContext(projectId));
  });

  app.post('/api/projects/:id/review-items/:itemId/replies', async (request, reply) => {
    const { id: projectId, itemId } = request.params as { id: string; itemId: string };
    const requestActor = await actor(request);
    await service.getProject(requestActor, projectId);
    return success(
      reply,
      request,
      personalStore.operations.createReviewReply(
        projectId,
        itemId,
        parsed(createProjectReviewReplySchema, request.body),
        requestActor,
      ),
      201,
    );
  });

  app.patch('/api/projects/:id/review-items/:itemId/replies/:replyId', async (request, reply) => {
    const {
      id: projectId,
      itemId,
      replyId,
    } = request.params as { id: string; itemId: string; replyId: string };
    const requestActor = await actor(request);
    const project = await service.getProject(requestActor, projectId);
    assertPermission(
      canCommentOnProject(requestActor, project),
      'Replies cannot be edited for this project.',
    );
    return success(
      reply,
      request,
      personalStore.operations.updateReviewReply(
        projectId,
        itemId,
        replyId,
        parsed(updateProjectReviewReplySchema, request.body),
        requestActor,
      ),
    );
  });

  app.post('/api/projects/:id/review-items/:itemId/attachments', async (request, reply) => {
    const { id: projectId, itemId } = request.params as { id: string; itemId: string };
    const requestActor = await actor(request);
    await service.getProject(requestActor, projectId);
    const input = parsed(linkProjectReviewDocumentSchema, request.body);
    return success(
      reply,
      request,
      personalStore.operations.linkReviewItemDocument(
        projectId,
        itemId,
        input.documentId,
        requestActor,
      ),
      201,
    );
  });

  app.post(
    '/api/projects/:id/review-items/:itemId/replies/:replyId/attachments',
    async (request, reply) => {
      const {
        id: projectId,
        itemId,
        replyId,
      } = request.params as {
        id: string;
        itemId: string;
        replyId: string;
      };
      const requestActor = await actor(request);
      await service.getProject(requestActor, projectId);
      const input = parsed(linkProjectReviewDocumentSchema, request.body);
      return success(
        reply,
        request,
        personalStore.operations.linkReviewReplyDocument(
          projectId,
          itemId,
          replyId,
          input.documentId,
          requestActor,
        ),
        201,
      );
    },
  );

  app.post('/api/projects/:id/revisions', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    const requestActor = await actor(request);
    const project = await service.getProject(requestActor, projectId);
    const input = parsed(projectRevisionSchema, request.body);
    if (!input.recoveryRevisionId) personalStore.createBackup('PRE_REVISION');
    const record = canonicalGenerationService
      ? canonicalGenerationService.createRegisterOnlyRevision(
          project,
          personalStore.getWorkspace(projectId),
          requestActor,
          input,
        )
      : personalStore.operations.createRevision(projectId, input);
    return success(reply, request, record, 201);
  });

  app.patch('/api/projects/:id/revisions/:itemId', async (request, reply) => {
    const { id: projectId, itemId } = request.params as { id: string; itemId: string };
    await service.getProject(await actor(request), projectId);
    const input = parsed(projectRevisionSchema, request.body);
    const canonicalRevision = scheduleCanonicalRegistry
      ? scheduleCanonicalRegistry.getRevisionByCompatibilityId(itemId)
      : null;
    if (canonicalRevision && canonicalRevision.projectId !== projectId) {
      throw new DomainError('NOT_FOUND', 'Revision not found.', 404);
    }
    return success(
      reply,
      request,
      personalStore.operations.updateRevision(
        projectId,
        itemId,
        canonicalRevision
          ? { ...input, revisionNumber: canonicalRevision.revisionSequence }
          : input,
      ),
    );
  });

  // GET canonical revisions for a project (read-only; P2-FND-05)
  app.get('/api/projects/:id/revisions', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    await service.getProject(await actor(request), projectId);
    const revisions = scheduleCanonicalRegistry
      ? scheduleCanonicalRegistry.listRevisions(projectId)
      : [];
    return success(reply, request, revisions);
  });

  // Package-only Revision projection. Keep Revision workspace metadata such as
  // Internal Note out of the Package browser context at the serialized boundary.
  app.get('/api/projects/:id/package-revisions', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    await service.getProject(await actor(request), projectId);
    const revisions = scheduleCanonicalRegistry
      ? scheduleCanonicalRegistry.listRevisions(projectId).map((revision) => ({
          revisionId: revision.revisionId,
          revisionSequence: revision.revisionSequence,
          revisionLabel: revision.revisionLabel,
          purpose: revision.purpose,
          lifecycleState: revision.lifecycleState,
          finalizedAt: revision.finalizedAt,
          luminaireCount: revision.luminaireSnapshot?.length ?? 0,
        }))
      : [];
    return success(reply, request, revisions);
  });

  // GET canonical outputs for a project (read-only; P2-FND-05)
  // Enriched with AUTHORITATIVE physical-artifact presence + safe open path
  // (reuses the single canonical presence authority — never locator-only).
  app.get('/api/projects/:id/outputs', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    await service.getProject(await actor(request), projectId);
    if (!scheduleCanonicalRegistry) {
      return success(reply, request, []);
    }
    const projectRoot = personalStore.getWorkspace(projectId).folderPath ?? null;
    const outputs = await Promise.all(
      scheduleCanonicalRegistry.listOutputs(projectId).map(async (output) => {
        const { presence, openPath } = await resolveCanonicalArtifactPresence(projectRoot, output);
        return { ...output, artifactPresence: presence, artifactOpenPath: openPath };
      }),
    );
    return success(reply, request, outputs);
  });

  // B0 — Revision Deliverable Foundation
  // - GET deliverables for a single Revision (unified GeneratedOutput + DocumentSnapshot).
  // - Prepare a manual PREPARING Revision.
  // - Add / remove an immutable Document Snapshot while PREPARING.
  // - Finalize a PREPARING Revision (requires >= 1 immutable Deliverable).
  app.post('/api/projects/:id/revisions/prepare', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    const requestActor = await actor(request);
    const project = await service.getProject(requestActor, projectId);
    if (!revisionDeliverableService) {
      throw new DomainError('CONFLICT', 'Revision Deliverable authority is unavailable.', 503);
    }
    const workspace = personalStore.getWorkspace(projectId);
    const input = parsed(prepareRevisionSchema, request.body ?? {});
    const revision = revisionDeliverableService.prepareRevision(
      project,
      workspace,
      requestActor,
      input,
    );
    return success(reply, request, revision, 201);
  });

  app.post('/api/projects/:id/revisions/:revisionId/duplicate', async (request, reply) => {
    const { id: projectId, revisionId } = request.params as { id: string; revisionId: string };
    const requestActor = await actor(request);
    const project = await service.getProject(requestActor, projectId);
    assertPermission(
      options.config.WORKSPACE_VARIANT === 'personal' && canManageSettings(requestActor),
      'Only the Personal workspace owner can duplicate Revisions.',
    );
    if (!revisionDeliverableService)
      throw new DomainError('CONFLICT', 'Revision Deliverable authority is unavailable.', 503);
    const input = parsed(duplicateRevisionSchema, request.body);
    return success(
      reply,
      request,
      revisionDeliverableService.duplicateRevision(project, revisionId, requestActor, input),
      201,
    );
  });

  app.patch('/api/projects/:id/revisions/:revisionId/metadata', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    const revisionId = (request.params as { revisionId: string }).revisionId;
    const requestActor = await actor(request);
    const project = await service.getProject(requestActor, projectId);
    if (!revisionDeliverableService) {
      throw new DomainError(
        'INTEGRATION_UNAVAILABLE',
        'Revision metadata authority is unavailable.',
        503,
      );
    }
    const input = parsed(updateRevisionMetadataSchema, request.body);
    const revision = revisionDeliverableService.updateRevisionMetadata(project, revisionId, input);
    return success(reply, request, revision);
  });

  app.get('/api/projects/:id/revisions/:revisionId/deliverables', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    const requestActor = await actor(request);
    const project = await service.getProject(requestActor, projectId);
    const revisionId = (request.params as { revisionId: string }).revisionId;
    if (!revisionDeliverableService) {
      throw new DomainError(
        'INTEGRATION_UNAVAILABLE',
        'Revision deliverables are unavailable.',
        503,
      );
    }
    const deliverables = await revisionDeliverableService.listRevisionDeliverables(
      project,
      revisionId,
    );
    return success(reply, request, deliverables);
  });

  app.post(
    '/api/projects/:id/revisions/:revisionId/deliverables/:deliverableId/file-handoff',
    async (request, reply) => {
      const params = parsed(
        z
          .object({
            id: z.string().uuid(),
            revisionId: z.string().uuid(),
            deliverableId: z.string().uuid(),
          })
          .strict(),
        request.params,
      );
      parsed(z.object({}).strict(), request.body ?? {});
      const project = await service.getProject(await actor(request), params.id);
      const root = await projectStorageService.resolveVerifiedProjectRoot(project);
      if (!revisionDeliverableService)
        throw new DomainError(
          'INTEGRATION_UNAVAILABLE',
          'Revision snapshots are unavailable.',
          503,
        );
      const file = await revisionDeliverableService.resolveDocumentSnapshotForOpen(
        project,
        params.revisionId,
        params.deliverableId,
        root,
      );
      return success(
        reply,
        request,
        desktopHandoffs.create({
          action: 'OPEN_REVISION_DELIVERABLE',
          projectId: project.id,
          revisionId: params.revisionId,
          deliverableId: params.deliverableId,
          managed: false,
          authorizedProjectRoot: file.root,
          targetPath: file.canonical,
          fileHash: createHash('sha256').update(file.bytes).digest('hex'),
          fileName: file.snapshot.fileName,
        }),
      );
    },
  );

  // PACKAGES-E2E-05A — Datasheet intake eligibility read (project/revision-scoped).
  app.get(
    '/api/projects/:id/revisions/:revisionId/datasheet-eligibility',
    async (request, reply) => {
      const projectId = (request.params as { id: string }).id;
      const requestActor = await actor(request);
      const project = await service.getProject(requestActor, projectId);
      await projectStorageService.resolveVerifiedProjectRoot(project);
      const revisionId = (request.params as { revisionId: string }).revisionId;
      if (!revisionDeliverableService) {
        throw new DomainError('INTEGRATION_UNAVAILABLE', 'Datasheet intake is unavailable.', 503);
      }
      const items = await revisionDeliverableService.listDatasheetEligibility(project, revisionId);
      return success(reply, request, items);
    },
  );

  // PACKAGES-E2E-05A — admit one Datasheet AssetVersion into a PREPARING
  // MANUAL_DELIVERABLES Revision. Body carries only assetVersionId; the server
  // re-resolves everything at mutation time (never trusts the eligibility read).
  app.post(
    '/api/projects/:id/revisions/:revisionId/datasheet-deliverables',
    async (request, reply) => {
      const projectId = (request.params as { id: string }).id;
      const requestActor = await actor(request);
      const project = await service.getProject(requestActor, projectId);
      const revisionId = (request.params as { revisionId: string }).revisionId;
      const input = parsed(addDatasheetDeliverableSchema, request.body);
      const verifiedRoot = await projectStorageService.resolveVerifiedProjectRoot(project);
      if (!revisionDeliverableService) {
        throw new DomainError('INTEGRATION_UNAVAILABLE', 'Datasheet intake is unavailable.', 503);
      }
      const snapshot = await revisionDeliverableService.addDatasheetDeliverableAtVerifiedRoot(
        project,
        revisionId,
        input.assetVersionId,
        requestActor,
        verifiedRoot,
      );
      return success(reply, request, snapshot, 201);
    },
  );

  app.post('/api/projects/:id/revisions/:revisionId/deliverables', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    const revisionId = (request.params as { revisionId: string }).revisionId;
    const requestActor = await actor(request);
    const project = await service.getProject(requestActor, projectId);
    const input = parsed(createRevisionDocumentSnapshotSchema, request.body);
    await projectStorageService.resolveVerifiedProjectRoot(project);
    if (!revisionDeliverableService) {
      throw new DomainError(
        'INTEGRATION_UNAVAILABLE',
        'Revision Deliverable service is not available.',
        503,
      );
    }
    const workspace = personalStore.getWorkspace(projectId);
    const snapshot = await revisionDeliverableService.createDocumentSnapshot(
      project,
      workspace,
      requestActor,
      revisionId,
      input,
    );
    return success(reply, request, snapshot, 201);
  });

  app.delete(
    '/api/projects/:id/revisions/:revisionId/deliverables/:deliverableId',
    async (request, reply) => {
      const projectId = (request.params as { id: string }).id;
      const requestActor = await actor(request);
      const project = await service.getProject(requestActor, projectId);
      const revisionId = (request.params as { revisionId: string }).revisionId;
      const deliverableId = (request.params as { deliverableId: string }).deliverableId;
      const verifiedRoot = await projectStorageService.resolveVerifiedProjectRoot(project);
      if (!revisionDeliverableService) {
        throw new DomainError(
          'INTEGRATION_UNAVAILABLE',
          'Revision Deliverable service is not available.',
          503,
        );
      }
      await revisionDeliverableService.removeDocumentSnapshotAtVerifiedRoot(
        project,
        revisionId,
        deliverableId,
        verifiedRoot,
      );
      return success(reply, request, { ok: true });
    },
  );

  app.post('/api/projects/:id/revisions/:revisionId/finalize', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    const requestActor = await actor(request);
    const project = await service.getProject(requestActor, projectId);
    const revisionId = (request.params as { revisionId: string }).revisionId;
    if (!revisionDeliverableService) {
      throw new DomainError(
        'INTEGRATION_UNAVAILABLE',
        'Revision Deliverable service is not available.',
        503,
      );
    }
    const revision = await revisionDeliverableService.finalizeRevision(project, revisionId);
    return success(reply, request, revision);
  });

  // C0 — Resume Revision: repairs a damaged composed MANUAL_DELIVERABLES draft
  // (FAILED_RECOVERABLE -> PREPARING). Lifecycle and provenance are server
  // authority only; the client supplies nothing but the path identity.
  app.post('/api/projects/:id/revisions/:revisionId/resume', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    const requestActor = await actor(request);
    const project = await service.getProject(requestActor, projectId);
    const revisionId = (request.params as { revisionId: string }).revisionId;
    if (!revisionDeliverableService) {
      throw new DomainError(
        'INTEGRATION_UNAVAILABLE',
        'Revision Deliverable service is not available.',
        503,
      );
    }
    const revision = await revisionDeliverableService.resumeRevision(project, revisionId);
    return success(reply, request, revision);
  });

  // P2C-03 — Safe Revision Delete eligibility (server truth; the UI never
  // invents delete eligibility). Returns structured canDelete / blockedReasons /
  // counts so the Inspector can show a readable reason for every block.
  app.get('/api/projects/:id/revisions/:revisionId/delete-eligibility', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    const requestActor = await actor(request);
    const project = await service.getProject(requestActor, projectId);
    const revisionId = (request.params as { revisionId: string }).revisionId;
    if (!revisionDeleteService) {
      throw new DomainError('INTEGRATION_UNAVAILABLE', 'Revision delete is unavailable.', 503);
    }
    const eligibility = await revisionDeleteService.deleteEligibility(
      project,
      revisionId,
      requestActor,
    );
    return success(reply, request, eligibility);
  });

  // P2C-04 — at most one server-derived immediate reuse candidate. The client
  // never scans tombstones or chooses a sequence.
  app.get('/api/projects/:id/revisions/reuse-eligibility', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    const requestActor = await actor(request);
    const project = await service.getProject(requestActor, projectId);
    if (!revisionReuseService) {
      throw new DomainError('INTEGRATION_UNAVAILABLE', 'Revision reuse is unavailable.', 503);
    }
    return success(reply, request, revisionReuseService.eligibility(project, requestActor));
  });

  // P2C-04 — explicit atomic reuse claim. Strict body contains only the
  // server-offered delete operation UUID and the normalized mandatory reason.
  app.post('/api/projects/:id/revisions/reuse', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    const requestActor = await actor(request);
    const project = await service.getProject(requestActor, projectId);
    const input = parsed(revisionReuseInputSchema, request.body);
    if (!revisionReuseService) {
      throw new DomainError('INTEGRATION_UNAVAILABLE', 'Revision reuse is unavailable.', 503);
    }
    const revision = revisionReuseService.reuseRevision(project, requestActor, input);
    return success(reply, request, revision, 201);
  });

  // P2C-03 — Safe Revision Delete mutation. The server re-runs the COMPLETE
  // eligibility check at mutation time (never trusts the prior GET), uses the
  // exact Revision UUID, archives owned artifacts first, then commits the DB
  // deletion atomically. Owner/Manager authorization is enforced server-side.
  app.delete('/api/projects/:id/revisions/:revisionId', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    const requestActor = await actor(request);
    const project = await service.getProject(requestActor, projectId);
    await projectStorageService.resolveVerifiedProjectRoot(project);
    const revisionId = (request.params as { revisionId: string }).revisionId;
    if (!revisionDeleteService) {
      throw new DomainError('INTEGRATION_UNAVAILABLE', 'Revision delete is unavailable.', 503);
    }
    const result = await revisionDeleteService.deleteRevision(project, revisionId, requestActor);
    return success(reply, request, result);
  });

  app.post('/api/projects/:id/documents', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    await service.getProject(await actor(request), projectId);
    const input = parsed(projectDocumentSchema, request.body);
    return success(reply, request, personalStore.operations.createDocument(projectId, input), 201);
  });

  app.patch('/api/projects/:id/documents/:itemId', async (request, reply) => {
    const { id: projectId, itemId } = request.params as { id: string; itemId: string };
    await service.getProject(await actor(request), projectId);
    const input = parsed(projectDocumentSchema, request.body);
    return success(
      reply,
      request,
      personalStore.operations.updateDocument(projectId, itemId, input),
    );
  });

  app.delete('/api/projects/:id/documents/:itemId', async (request, reply) => {
    const { id: projectId, itemId } = request.params as { id: string; itemId: string };
    await service.getProject(await actor(request), projectId);
    return success(reply, request, personalStore.operations.removeDocument(projectId, itemId));
  });

  app.post('/api/projects/:id/contacts', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    await service.getProject(await actor(request), projectId);
    const input = parsed(projectContactSchema, request.body);
    return success(reply, request, personalStore.operations.createContact(projectId, input), 201);
  });

  app.patch('/api/projects/:id/contacts/:itemId', async (request, reply) => {
    const { id: projectId, itemId } = request.params as { id: string; itemId: string };
    await service.getProject(await actor(request), projectId);
    const input = parsed(projectContactSchema, request.body);
    return success(
      reply,
      request,
      personalStore.operations.updateContact(projectId, itemId, input),
    );
  });

  app.post('/api/projects/:id/create-folders', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    const project = await service.getProject(await actor(request), projectId);
    const input = parsed(createProjectFoldersSchema, request.body);
    const workspace = personalStore.getWorkspace(projectId);
    if (workspace.folderPath) {
      throw new DomainError('CONFLICT', 'This project already has a local folder.', 409);
    }
    const settings = personalStore.getSettings();
    const profileName = input.folderProfile ?? workspace.folderProfile;
    const profile = personalStore
      .listFolderProfiles()
      .find((candidate) => candidate.name === profileName);
    if (!profile) throw new DomainError('VALIDATION_ERROR', 'Unknown folder profile.', 400);
    const folders = input.folderStructure ?? workspace.folderStructure ?? profile.folders;
    const outputFolders = input.outputFolders ?? workspace.outputFolders ?? profile.outputFolders;
    const effectiveProfile = {
      ...profile,
      folders,
      outputFolders,
    };
    const created = folderService.create(
      input.projectRoot ?? settings.projectRoot,
      project,
      effectiveProfile,
    );
    await projectStorageService.bindProgramOwnedRoot(project, created.folderPath);
    personalStore.updateFolderConfiguration(
      projectId,
      effectiveProfile.name,
      effectiveProfile.folders,
      effectiveProfile.outputFolders,
    );
    return success(reply, request, created, 201);
  });

  app.patch('/api/projects/:id/workspace-setup', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    const project = await service.getProject(await actor(request), projectId);
    if (project.status === 'Completed' || project.status === 'Cancelled') {
      throw new DomainError(
        'INVALID_TRANSITION',
        'Completed or cancelled projects must be reopened before their workspace can be edited.',
        409,
      );
    }
    const input = parsed(updateProjectWorkspaceSetupInputSchema, request.body);
    const current = personalStore.getWorkspace(projectId);
    const folderPath = input.connectFolderPath
      ? folderService.connectExisting(input.connectFolderPath)
      : current.folderPath;
    personalStore.updateFolderConfiguration(
      projectId,
      input.folderProfile,
      input.folderStructure,
      input.outputFolders,
    );
    const scopeItems = input.scopeItems
      ? normalizeScopeItemInputs(input.scopeItems)
      : input.services !== undefined
        ? replaceBuiltInScopeItems(current.scopeItems, input.services)
        : current.scopeItems;
    personalStore.updateScope(projectId, scopeItems);
    if (input.connectFolderPath) personalStore.setFolderPath(projectId, folderPath!);
    const createdFolderCount =
      input.ensureFolders && folderPath
        ? folderService.ensureStructure(folderPath, input.folderStructure)
        : 0;
    const updatedWorkspace = personalStore.getWorkspace(projectId);
    await options.provider.updateProject(projectId, {
      services: updatedWorkspace.services,
      folderProfile: input.folderProfile,
      projectFolderPath: folderPath,
      updatedAt: new Date().toISOString(),
      version: project.version + 1,
    });
    return success(reply, request, {
      workspace: updatedWorkspace,
      createdFolderCount,
    });
  });

  app.post('/api/projects/:id/folder-actions/preview', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    const project = await service.getProject(await actor(request), projectId);
    const input = parsed(folderActionPreviewSchema, request.body);
    return success(reply, request, folderStructureService.preview(project, input));
  });

  app.post('/api/projects/:id/folder-actions', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    const project = await service.getProject(await actor(request), projectId);
    const input = parsed(folderActionSchema, request.body);
    return success(reply, request, await folderStructureService.execute(project, input));
  });

  app.patch('/api/projects/:id/scope', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    const project = await service.getProject(await actor(request), projectId);
    if (project.status === 'Completed' || project.status === 'Cancelled') {
      throw new DomainError(
        'INVALID_TRANSITION',
        'Completed or cancelled projects must be reopened before their scope can be edited.',
        409,
      );
    }
    const input = parsed(updateProjectScopeSchema, request.body);
    if (input.expectedVersion !== undefined && input.expectedVersion !== project.version) {
      throw new DomainError(
        'CONFLICT',
        'This project changed after you opened it. Refresh and review the latest values.',
        409,
        { expectedVersion: input.expectedVersion, latestVersion: project.version },
      );
    }
    const current = personalStore.getWorkspace(projectId);
    const updatedWorkspace = personalStore.updateScope(projectId, input.scopeItems);
    await options.provider.updateProject(projectId, {
      services: updatedWorkspace.services,
      updatedAt: new Date().toISOString(),
      version: project.version + 1,
    });
    const before = current.scopeItems;
    const after = updatedWorkspace.scopeItems;
    const removed = before.filter((item) => !after.some((candidate) => candidate.id === item.id));
    const added = after.filter((item) => !before.some((candidate) => candidate.id === item.id));
    const detail = `Scope updated. Added: ${
      added.map((item) => item.label).join(', ') || 'none'
    }. Removed: ${removed.map((item) => item.label).join(', ') || 'none'}.`;
    personalStore.operations.recordWorkspaceActivity(
      projectId,
      'workspace',
      null,
      'ScopeUpdated',
      'Project scope updated',
      detail,
      new Date().toISOString(),
    );
    return success(reply, request, { workspace: updatedWorkspace });
  });

  app.patch('/api/projects/:id/deliverables/:deliverableId', async (request, reply) => {
    const { id, deliverableId } = request.params as { id: string; deliverableId: string };
    await service.getProject(await actor(request), id);
    const input = parsed(updateDeliverableSchema, request.body);
    const updated = personalStore.updateDeliverable(id, deliverableId, input);
    await syncPersonalProjectProgress(id);
    return success(reply, request, updated);
  });

  const studioRuntimeRoot =
    [
      fileURLToPath(new URL('../../../', import.meta.url)),
      process.cwd(),
      path.resolve(process.cwd(), '../..'),
    ].find((root) => existsSync(path.join(root, 'tools/luminaire-studio-v1.4.1/core.js'))) ??
    process.cwd();
  const studioSourceRoot =
    process.env.SCT_STUDIO_SOURCE_ROOT ||
    path.join(studioRuntimeRoot, 'tools/luminaire-studio-v1.4.1');
  const studioWorkspace =
    options.config.WORKSPACE_VARIANT === 'personal' &&
    existsSync(path.join(studioSourceRoot, 'core.js'))
      ? new StudioWorkspaceService(
          personalStore,
          new StudioDocumentStore(libraryDatabase),
          studioSourceRoot,
        )
      : null;
  const studioProject = async (request: FastifyRequest) => {
    const current = await actor(request);
    assertPermission(
      options.config.WORKSPACE_VARIANT === 'personal' && canManageSettings(current),
      'Only the Personal workspace owner can use Luminaire Studio.',
    );
    if (!studioWorkspace)
      throw new DomainError(
        'CONFIGURATION_REQUIRED',
        'Luminaire Studio 1.4.1 source is unavailable.',
        409,
      );
    const project = await service.getProject(current, (request.params as { id: string }).id);
    return { current, project, studio: studioWorkspace };
  };
  const studioTemplates = new StudioTemplateStore(libraryDatabase);
  app.get('/api/luminaire-studio/templates', async (request, reply) => {
    const current = await actor(request);
    assertPermission(
      options.config.WORKSPACE_VARIANT === 'personal' && canManageSettings(current),
      'Only the Personal workspace owner can read Studio templates.',
    );
    return success(reply, request, studioTemplates.read());
  });
  app.put('/api/luminaire-studio/templates', async (request, reply) => {
    const current = await actor(request);
    assertPermission(
      options.config.WORKSPACE_VARIANT === 'personal' && canManageSettings(current),
      'Only the Personal workspace owner can save Studio templates.',
    );
    return success(
      reply,
      request,
      personalStore.runInTransaction(() =>
        studioTemplates.save(parsed(studioTemplatesSchema, request.body), current),
      ),
    );
  });
  const studioAssets = new StudioAssetBridge(personalStore, luminaireAssetStorage, dataRoot);
  const studioOutputs = scheduleCanonicalRegistry
    ? new StudioOutputService(scheduleCanonicalRegistry, studioRuntimeRoot)
    : null;
  app.post('/api/projects/:id/luminaire-studio/outputs', async (request, reply) => {
    const { project, studio, current } = await studioProject(request);
    if (!studioOutputs)
      throw new DomainError(
        'CONFIGURATION_REQUIRED',
        'Canonical Output storage is unavailable.',
        409,
      );
    const input = parsed(studioOutputRequestSchema, request.body);
    const state = studio.read(project);
    if (input.version !== state.version || input.baseFingerprint !== state.fingerprint)
      throw new DomainError('CONFLICT', 'Studio changed. Reload before generating outputs.', 409);
    const verifiedRoot = await projectStorageService.resolveVerifiedProjectRoot(project);
    await studioAssets.hydrate(state.document, verifiedRoot);
    return success(
      reply,
      request,
      await studioOutputs.generate(
        project,
        personalStore.getWorkspace(project.id),
        current,
        state.document,
        input,
      ),
      201,
    );
  });
  app.get(
    '/api/projects/:id/luminaire-studio/outputs/:outputId/download',
    async (request, reply) => {
      const { project } = await studioProject(request);
      if (!studioOutputs)
        throw new DomainError(
          'CONFIGURATION_REQUIRED',
          'Canonical Output storage is unavailable.',
          409,
        );
      await projectStorageService.resolveVerifiedProjectRoot(project);
      const result = await studioOutputs.download(
        project,
        personalStore.getWorkspace(project.id),
        (request.params as { outputId: string }).outputId,
      );
      return reply
        .type(result.type)
        .header('Content-Disposition', `attachment; filename="${result.name.replaceAll('"', '_')}"`)
        .send(result.bytes);
    },
  );
  app.get('/api/projects/:id/luminaire-studio', async (request, reply) => {
    const { project, studio } = await studioProject(request);
    const state = studio.read(project);
    const verifiedRoot = await projectStorageService
      .resolveVerifiedProjectRoot(project)
      .catch(() => null);
    await studioAssets.hydrate(state.document, verifiedRoot);
    return success(reply, request, state);
  });
  app.put(
    '/api/projects/:id/luminaire-studio',
    { bodyLimit: 52 * 1024 * 1024 },
    async (request, reply) => {
      const { project, studio, current } = await studioProject(request);
      const input = parsed(saveStudioDocumentSchema, request.body);
      if (input.document.id !== project.id)
        throw new DomainError('CONFLICT', 'Studio must use the current project identity.', 409);
      const prepared = await studioAssets.prepare(input.document);
      try {
        return success(reply, request, studio.save(project, input, current, prepared));
      } catch (error) {
        await Promise.all(prepared.map((asset) => asset.managed.cleanup()));
        throw error;
      }
    },
  );

  app.post('/api/projects/:id/luminaires', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    const requestActor = await actor(request);
    await service.getProject(requestActor, projectId);
    const input = parsed(luminaireRecordSchema, request.body);
    return success(
      reply,
      request,
      personalStore.runInTransaction(() =>
        personalStore.addLuminaire(projectId, input, requestActor),
      ),
      201,
    );
  });

  app.post('/api/projects/:id/luminaires/import-preview', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    await service.getProject(await actor(request), projectId);
    const input = parsed(importLuminaireCsvSchema, request.body);
    const records = importLuminaireCsv(input.csvText).map((record) =>
      parsed(luminaireImportPatchSchema, record),
    );
    const existing = personalStore.getWorkspace(projectId).luminaires;
    // Project-scoped candidate lookup: every existing Luminaire whose normalized
    // Tag equals the incoming row's normalized Tag. Historical mixed-case
    // duplicates (DL01 / Dl01) both normalize to the same key and are therefore
    // BOTH candidates — the preview must never collapse them into one target.
    const candidatesByTag = new Map<string, LuminaireRecord[]>();
    for (const record of existing) {
      const key = normalizeLuminaireTag(record.tag);
      const list = candidatesByTag.get(key);
      if (list) list.push(record);
      else candidatesByTag.set(key, [record]);
    }
    const tagCount = new Map<string, number>();
    records.forEach((record) => {
      const key = normalizeLuminaireTag(record.tag);
      tagCount.set(key, (tagCount.get(key) ?? 0) + 1);
    });
    const rows = records.map((record, index) => {
      const key = normalizeLuminaireTag(record.tag);
      const candidates = candidatesByTag.get(key) ?? [];
      const matchStatus: LuminaireImportMatchStatus =
        candidates.length === 0 ? 'None' : candidates.length === 1 ? 'Unique' : 'Ambiguous';
      const uniqueTarget = matchStatus === 'Unique' ? candidates[0]! : undefined;
      // Only source-supplied fields are present in the patch, so absent
      // columns can never be reported as changed-to-empty.
      const changedFields = uniqueTarget
        ? Object.entries(record)
            .filter(
              ([field, value]) =>
                String(uniqueTarget[field as keyof typeof uniqueTarget] ?? '') !==
                String(value ?? ''),
            )
            .map(([field]) => field)
        : [];
      const status =
        (tagCount.get(key) ?? 0) > 1
          ? 'Duplicate'
          : matchStatus === 'None'
            ? 'Added'
            : matchStatus === 'Ambiguous'
              ? 'Ambiguous'
              : changedFields.length
                ? 'Changed'
                : 'Unchanged';
      return {
        rowId: `${index + 1}:${record.tag}`,
        status,
        matchStatus,
        // An ambiguous row must NOT auto-select a target. The user must choose
        // one of the actual candidates explicitly before commit.
        existingId: uniqueTarget?.id ?? null,
        candidates: candidates.map((candidate) => ({
          id: candidate.id,
          tag: candidate.tag,
          manufacturer: candidate.manufacturer,
          model: candidate.model,
          description: candidate.description,
          wattage: candidate.wattage,
        })),
        changedFields,
        record,
      };
    });
    return success(reply, request, { source: input.source, rows });
  });

  app.post('/api/projects/:id/luminaires/import-commit', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    await service.getProject(await actor(request), projectId);
    const input = parsed(commitLuminaireImportSchema, request.body);
    const mutating = input.rows.filter((row) => row.action === 'Add' || row.action === 'Update');
    if (!mutating.length) {
      throw new DomainError('VALIDATION_ERROR', 'Choose at least one row to add or update.', 400);
    }
    // Re-read the CURRENT project Luminaires. The preview payload is never
    // trusted blindly: the server independently recomputes candidates and
    // revalidates every target against the current state.
    const existing = personalStore.getWorkspace(projectId).luminaires;
    const existingById = new Map(existing.map((record) => [record.id, record]));
    const candidatesByTag = new Map<string, LuminaireRecord[]>();
    for (const record of existing) {
      const key = normalizeLuminaireTag(record.tag);
      const list = candidatesByTag.get(key);
      if (list) list.push(record);
      else candidatesByTag.set(key, [record]);
    }

    // ---- FULL PREFLIGHT (VALIDATE EVERYTHING FIRST) -----------------------
    // Every non-skipped row is validated against the CURRENT DB state before
    // the first mutation. An import containing any invalid row is rejected
    // wholesale, so no partial write can ever occur.
    const usedTargets = new Set<string>();
    const addNormalizedTags = new Set<string>();
    for (const row of input.rows) {
      const normalizedIncoming = normalizeLuminaireTag(row.record.tag);
      const candidates = candidatesByTag.get(normalizedIncoming) ?? [];

      if (row.action === 'Add') {
        // The contract schema already rejects an Add that carries an
        // existingId or a non-None matchStatus. Recompute the CURRENT
        // candidate set (A2 blocker): an Add must have zero current candidates
        // for its normalized Tag. This catches stale previews, forged Adds, a
        // matching Luminaire created after preview, and a client changing an
        // Update into an Add to bypass target validation. Mirrors the store's
        // duplicate-Tag conflict contract so direct commit and manual API Add
        // behave identically.
        if (candidates.length > 0) {
          throw new DomainError('CONFLICT', duplicateLuminaireTagMessage(candidates[0]!.tag), 409, {
            field: 'tag',
            normalizedTag: normalizedIncoming,
            projectId,
          });
        }
        // Duplicate Add within ONE commit: the same normalized Tag may be
        // Added only once (also catches mixed-case DL01 + dl01).
        if (addNormalizedTags.has(normalizedIncoming)) {
          throw new DomainError(
            'VALIDATION_ERROR',
            `Multiple import rows would add the same Type / Tag "${canonicalizeLuminaireTag(row.record.tag)}".`,
            400,
          );
        }
        addNormalizedTags.add(normalizedIncoming);
        continue;
      }

      if (row.action === 'Update') {
        // Update rows require an explicit target.
        if (!row.existingId) {
          throw new DomainError(
            'VALIDATION_ERROR',
            `Type / Tag "${canonicalizeLuminaireTag(row.record.tag)}" has no update target.`,
            400,
          );
        }
        const target = existingById.get(row.existingId);
        // 1. Target must currently exist and belong to this project.
        if (!target) {
          throw new DomainError(
            'VALIDATION_ERROR',
            `Type / Tag "${canonicalizeLuminaireTag(row.record.tag)}" has no valid update target.`,
            400,
          );
        }
        // 2. The target's normalized Tag must equal the incoming row's normalized Tag.
        if (normalizeLuminaireTag(target.tag) !== normalizedIncoming) {
          throw new DomainError(
            'VALIDATION_ERROR',
            `Type / Tag "${canonicalizeLuminaireTag(row.record.tag)}" does not match the selected luminaire. Refresh the preview.`,
            400,
          );
        }
        // 3. The target must be one of the CURRENT candidates for that normalized Tag.
        if (!candidates.some((candidate) => candidate.id === target.id)) {
          throw new DomainError(
            'VALIDATION_ERROR',
            `Type / Tag "${canonicalizeLuminaireTag(row.record.tag)}" does not match the selected luminaire. Refresh the preview.`,
            400,
          );
        }
        // 4. Ambiguity must be respected: an ambiguous normalized Tag requires
        //    an explicit manual selection; a unique one must not be guessed.
        //    A None matchStatus is structurally incompatible with a target.
        if (row.matchStatus === 'None') {
          throw new DomainError(
            'VALIDATION_ERROR',
            `Type / Tag "${canonicalizeLuminaireTag(row.record.tag)}" has an update target but the preview reports no match. Refresh the preview.`,
            400,
          );
        }
        if (candidates.length > 1) {
          if (row.matchStatus !== 'Ambiguous') {
            throw new DomainError(
              'VALIDATION_ERROR',
              `Type / Tag "${canonicalizeLuminaireTag(row.record.tag)}" matches multiple existing luminaires. Choose the luminaire to update.`,
              400,
            );
          }
        } else if (row.matchStatus === 'Ambiguous') {
          // A row that claims ambiguity but currently has a unique target is
          // stale — the current state no longer matches the preview.
          throw new DomainError(
            'VALIDATION_ERROR',
            `Import target for Type / Tag "${canonicalizeLuminaireTag(row.record.tag)}" changed. Refresh the preview.`,
            400,
          );
        } else if (candidates.length === 0) {
          throw new DomainError(
            'VALIDATION_ERROR',
            `Type / Tag "${canonicalizeLuminaireTag(row.record.tag)}" no longer matches an update target. Refresh the preview.`,
            400,
          );
        }
        // 5. A Tag cannot be both Added and Updated within one commit.
        if (addNormalizedTags.has(normalizedIncoming)) {
          throw new DomainError(
            'VALIDATION_ERROR',
            `Type / Tag "${canonicalizeLuminaireTag(row.record.tag)}" cannot be added and updated in the same import. Refresh the preview.`,
            400,
          );
        }
        // 6. Repeated target: one existing Luminaire may be targeted by only one row.
        if (usedTargets.has(target.id)) {
          throw new DomainError(
            'VALIDATION_ERROR',
            'Multiple import rows target the same luminaire. Review the import before committing.',
            400,
          );
        }
        usedTargets.add(target.id);
        continue;
      }

      // Ignore / ManualReview: non-mutating rows. They never write and never
      // participate in target/duplicate checks, so they cannot smuggle an
      // existingId into the mutation set.
    }

    // ---- BACKUP before the transaction -----------------------------------
    // Preflight has passed, so a backup is only created when a mutation is
    // actually going to run. createBackup is a filesystem side effect (VACUUM
    // INTO), not a DB mutation, so it stays outside the transaction.
    personalStore.createBackup('PRE_IMPORT');

    // ---- ONE TRANSACTION: all row writes + input-mode update --------------
    // The entire logical import commit is atomic. Any row write, input-mode
    // write, or DB failure rolls back the whole transaction so a partial
    // import can never be committed. This closes the A2 partial-commit defect
    // where a valid earlier row survived even though a later row failed.
    const { added, updated } = personalStore.runInTransaction(() => {
      let addedCount = 0;
      let updatedCount = 0;
      for (const row of input.rows) {
        if (row.action === 'Add') {
          // Expand the presence-aware patch to a full record, filling absent
          // fields with their defaults. Add-only behavior is unchanged.
          personalStore.addLuminaire(projectId, luminaireRecordSchema.parse(row.record));
          addedCount += 1;
        } else if (row.action === 'Update') {
          // Merge the patch onto the existing record so fields whose columns
          // were absent from the source are preserved rather than cleared.
          const current = existingById.get(row.existingId!)!;
          const merged: LuminaireRecordInput = {
            tag: current.tag,
            category: current.category,
            imagePath: current.imagePath,
            description: current.description,
            manufacturer: current.manufacturer,
            model: current.model,
            wattage: current.wattage,
            lumens: current.lumens,
            lightColor: current.lightColor,
            cri: current.cri,
            beamAngle: current.beamAngle,
            ipRating: current.ipRating,
            mounting: current.mounting,
            cutout: current.cutout,
            driver: current.driver,
            control: current.control,
            emergency: current.emergency,
            datasheetPath: current.datasheetPath,
            location: current.location,
            unit: current.unit,
            quantity: current.quantity,
            notes: current.notes,
            sourceName: current.sourceName,
            dimensions: current.dimensions,
            bodyColorFinish: current.bodyColorFinish,
          };
          // Apply only the source-supplied patch fields. Absent columns are
          // omitted from the patch, so they fall back to the preserved `current`
          // values above. Object.assign avoids the partial-patch spread widening
          // the merged record's fields to `string | undefined`.
          Object.assign(merged, row.record);
          // Import Tags identify the preview-selected record. When the comparison
          // identity is unchanged, preserve an exact historical mixed-case Tag and
          // patch only the source fields instead of turning the update into a Tag
          // edit. A genuinely different Tag still reaches the store canonicalizer.
          if (normalizeLuminaireTag(row.record.tag) === normalizeLuminaireTag(current.tag)) {
            merged.tag = current.tag;
          }
          personalStore.updateLuminaire(projectId, row.existingId!, merged);
          updatedCount += 1;
        }
      }
      // The per-project Luminaire Input Mode update participates in the SAME
      // transaction as the row writes, so a failure on either side rolls back
      // the whole import.
      personalStore.updateLightingPackage(projectId, { inputMode: input.source });
      return { added: addedCount, updated: updatedCount };
    });
    return success(
      reply,
      request,
      { added, updated, ignored: input.rows.length - added - updated },
      201,
    );
  });

  app.patch('/api/projects/:id/luminaires/:luminaireId/technical-field', async (request, reply) => {
    const { id, luminaireId } = parsed(
      z.object({ id: z.uuid(), luminaireId: z.uuid() }).strict(),
      request.params,
    );
    const currentActor = await actor(request);
    await service.getProject(currentActor, id);
    assertPermission(
      canManageSettings(currentActor),
      'Only the owner can correct Project technical data.',
    );
    const input = parsed(editProjectTechnicalFieldSchema, request.body);
    const updated = personalStore.runInTransaction(() => {
      const current = personalStore
        .getWorkspace(id)
        .luminaires.find((row) => row.id === luminaireId);
      if (!current) throw new DomainError('NOT_FOUND', 'Project luminaire not found.', 404);
      if (current.rowVersion !== input.expectedRowVersion)
        throw new DomainError(
          'CONFLICT',
          'This Project luminaire changed. Refresh before saving.',
          409,
        );
      return personalStore.updateLuminaire(
        id,
        luminaireId,
        luminaireRecordSchema.parse({ ...current, [input.fieldKey]: input.value }),
        currentActor,
      );
    });
    return success(reply, request, updated);
  });
  app.patch('/api/projects/:id/luminaires/:luminaireId', async (request, reply) => {
    const { id, luminaireId } = request.params as { id: string; luminaireId: string };
    const requestActor = await actor(request);
    await service.getProject(requestActor, id);
    const input = parsed(luminaireRecordSchema, request.body);
    return success(
      reply,
      request,
      personalStore.runInTransaction(() =>
        personalStore.updateLuminaire(id, luminaireId, input, requestActor),
      ),
    );
  });

  app.get('/api/local-ai/status', async (request, reply) => {
    const current = await actor(request);
    assertPermission(
      options.config.WORKSPACE_VARIANT === 'personal' && canManageSettings(current),
      'Only the Personal owner can access local AI.',
    );
    let ready = false;
    let reason = options.config.LOCAL_AI_ENABLED
      ? 'Local AI runtime is missing. Keep Local AI Models beside the trial executable and install Ollama.'
      : 'Local AI is available only in the separate trial edition.';
    if (localVision) {
      try {
        await localVision.check();
        ready = true;
        reason = 'Local-only vision · light profile · one page at a time';
      } catch (error) {
        reason = error instanceof Error ? error.message : 'Local AI is unavailable.';
      }
    }
    return success(reply, request, {
      enabled: options.config.LOCAL_AI_ENABLED,
      ready,
      model: LOCAL_VISION_MODEL,
      reason,
      localOnly: true,
    });
  });
  const localAiContext = async (request: FastifyRequest) => {
    const current = await actor(request);
    assertPermission(
      options.config.LOCAL_AI_ENABLED &&
        options.config.WORKSPACE_VARIANT === 'personal' &&
        canManageSettings(current),
      'Local AI requires the trial edition and Personal owner access.',
    );
    const { id, luminaireId } = parsed(
      z.object({ id: z.uuid(), luminaireId: z.uuid() }).strict(),
      request.params,
    );
    await service.getProject(current, id);
    const luminaire = personalStore.getLuminaireRecord(luminaireId, id);
    if (!localAiReview)
      throw new DomainError(
        'CONFLICT',
        'The local AI runtime is unavailable. Check the trial setup.',
        409,
      );
    return { current, id, luminaireId, luminaire, review: localAiReview };
  };
  app.get('/api/projects/:id/luminaires/:luminaireId/local-ai', async (request, reply) => {
    const context = await localAiContext(request);
    const report = await context.review.current(context.id, context.luminaireId);
    const latestAsset = personalStore.listLuminaireAssetVersions(
      context.id,
      context.luminaireId,
      'Datasheet',
    )[0];
    const stale = report
      ? latestAsset?.id !== report.assetVersionId ||
        localAiFieldSchema.options.some(
          (field) =>
            String(context.luminaire[field] ?? '').slice(0, 1000) !== report.projectSnapshot[field],
        )
      : false;
    return success(reply, request, report ? { ...report, stale } : null);
  });
  app.post('/api/projects/:id/luminaires/:luminaireId/local-ai', async (request, reply) => {
    parsed(z.object({}).strict(), request.body);
    const context = await localAiContext(request);
    const asset = personalStore.listLuminaireAssetVersions(
      context.id,
      context.luminaireId,
      'Datasheet',
    )[0];
    if (!asset) throw new DomainError('NOT_FOUND', 'Attach a Datasheet before scanning.', 404);
    if (!asset.fileHash)
      throw new DomainError(
        'CONFLICT',
        'Attach a verified Datasheet with a content hash before scanning.',
        409,
      );
    const file = await resolveDocumentLuminaireAssetSource(asset.id);
    const snapshot = Object.fromEntries(
      localAiFieldSchema.options.map((field) => [
        field,
        String(context.luminaire[field] ?? '').slice(0, 1000),
      ]),
    );
    return success(
      reply,
      request,
      await context.review.start({
        projectId: context.id,
        luminaireId: context.luminaireId,
        assetVersionId: asset.id,
        sourceHash: asset.fileHash,
        actorId: context.current.id,
        file,
        snapshot,
      }),
      202,
    );
  });
  app.post('/api/projects/:id/luminaires/:luminaireId/local-ai/cancel', async (request, reply) => {
    parsed(z.object({}).strict(), request.body);
    const context = await localAiContext(request);
    context.review.cancel(context.id, context.luminaireId);
    return success(reply, request, { cancelled: true });
  });
  app.get('/api/projects/:id/luminaires/:luminaireId/local-ai/page', async (request, reply) => {
    const context = await localAiContext(request);
    const query = parsed(
      z.object({ pageNumber: z.coerce.number().int().min(1).max(200) }).strict(),
      request.query,
    );
    const report = await context.review.current(context.id, context.luminaireId);
    if (!report || query.pageNumber > report.totalPages)
      throw new DomainError('NOT_FOUND', 'This review page is unavailable.', 404);
    const file = await resolveDocumentLuminaireAssetSource(report.assetVersionId);
    const image = await new PdfExtractionAdapter().renderPage(file, query.pageNumber);
    return success(reply, request, {
      pngBase64: image.png.toString('base64'),
      pageNumber: image.pageNumber,
    });
  });

  const datasheetImageContext = async (
    request: FastifyRequest,
    pageNumber: number,
    includeImages = true,
  ) => {
    const current = await actor(request);
    assertPermission(
      options.config.WORKSPACE_VARIANT === 'personal' && canManageSettings(current),
      'Only the Personal owner can extract product images.',
    );
    const { id, luminaireId } = parsed(
      z.object({ id: z.uuid(), luminaireId: z.uuid() }).strict(),
      request.params,
    );
    await service.getProject(current, id);
    const asset = personalStore.listLuminaireAssetVersions(id, luminaireId, 'Datasheet')[0];
    if (!asset)
      throw new DomainError(
        'NOT_FOUND',
        'Attach a Datasheet before extracting a product image.',
        404,
      );
    const file = await resolveDocumentLuminaireAssetSource(asset.id);
    const images = (
      includeImages ? await new PdfExtractionAdapter().images(file, pageNumber) : []
    ).map((image) => ({
      ...image,
      hash: createHash('sha256').update(image.bytes).digest('hex'),
    }));
    return { current, id, luminaireId, asset, images, file };
  };
  app.get('/api/projects/:id/luminaires/:luminaireId/datasheet-page', async (request, reply) => {
    const query = parsed(
      z.object({ pageNumber: z.coerce.number().int().min(1).max(200) }).strict(),
      request.query,
    );
    const context = await datasheetImageContext(request, query.pageNumber, false);
    const page = await new PdfExtractionAdapter().renderPage(context.file, query.pageNumber);
    return success(reply, request, {
      sourceAssetVersionId: context.asset.id,
      pageNumber: page.pageNumber,
      width: page.width,
      height: page.height,
      pngBase64: page.png.toString('base64'),
    });
  });
  app.get('/api/projects/:id/luminaires/:luminaireId/datasheet-images', async (request, reply) => {
    const query = parsed(
      z.object({ pageNumber: z.coerce.number().int().min(1).max(200) }).strict(),
      request.query,
    );
    const context = await datasheetImageContext(request, query.pageNumber);
    return success(reply, request, {
      sourceAssetVersionId: context.asset.id,
      currentImageVersionId:
        personalStore.listLuminaireAssetVersions(context.id, context.luminaireId, 'ProductImage')[0]
          ?.id ?? null,
      images: context.images.map(({ bytes, ...image }) => ({
        ...image,
        pngBase64: bytes.toString('base64'),
      })),
    });
  });
  app.post('/api/projects/:id/luminaires/:luminaireId/datasheet-images', async (request, reply) => {
    const input = parsed(datasheetImageSelectionSchema, request.body);
    const context = await datasheetImageContext(request, input.pageNumber);
    const assertCurrent = () => {
      if (
        personalStore.listLuminaireAssetVersions(context.id, context.luminaireId, 'Datasheet')[0]
          ?.id !== input.sourceAssetVersionId ||
        (personalStore.listLuminaireAssetVersions(
          context.id,
          context.luminaireId,
          'ProductImage',
        )[0]?.id ?? null) !== input.currentImageVersionId
      )
        throw new DomainError(
          'CONFLICT',
          'The Datasheet or product image changed. Reload the image choices.',
          409,
        );
    };
    assertCurrent();
    const selected = context.images.find((image) => image.hash === input.imageHash);
    if (!selected)
      throw new DomainError(
        'CONFLICT',
        'The selected image is not in this exact Datasheet page.',
        409,
      );
    const document = {
      id: context.id,
      luminaires: [
        {
          id: context.luminaireId,
          tag: context.luminaireId,
          image: `data:image/png;base64,${selected.bytes.toString('base64')}`,
        },
      ],
    };
    const prepared = await studioAssets.prepare(document);
    const managed = prepared[0]?.managed;
    if (!managed) return success(reply, request, { unchanged: true });
    try {
      return success(
        reply,
        request,
        personalStore.runInTransaction(() => {
          assertCurrent();
          return personalStore.attachLuminaireAsset(
            context.id,
            context.luminaireId,
            { assetType: 'ProductImage', filePath: 'datasheet-product.png' },
            context.current,
            managed,
          );
        }),
        201,
      );
    } catch (error) {
      await managed.cleanup();
      throw error;
    }
  });

  app.get('/api/projects/:id/luminaire-assets', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    await service.getProject(await actor(request), projectId);
    return success(reply, request, personalStore.listLuminaireAssetSummaries(projectId));
  });

  const assetAccessParams = z
    .object({ id: z.uuid(), luminaireId: z.uuid(), versionId: z.uuid() })
    .strict();
  const resolveAssetAccess = async (
    params: z.infer<typeof assetAccessParams>,
    current: AppUser,
  ) => {
    const project = await service.getProject(current, params.id);
    const version = personalStore
      .listLuminaireAssetVersions(params.id, params.luminaireId)
      .find((item) => item.id === params.versionId);
    if (!version)
      throw new DomainError('NOT_FOUND', 'Asset version not found in this luminaire.', 404);
    const managed = version.locatorKind === 'DATA_ROOT_RELATIVE';
    const root = managed
      ? dataRoot
      : await projectStorageForDocuments.resolveVerifiedProjectRoot(project);
    const candidate = managed
      ? luminaireAssetStorage.resolveLocator(version.locatorValue ?? '')
      : version.filePath;
    const access = await readLuminaireAsset(version, root, candidate);
    return { ...access, version, managed };
  };
  app.get(
    '/api/projects/:id/luminaires/:luminaireId/asset-versions/:versionId/content',
    async (request, reply) => {
      const result = await resolveAssetAccess(
        parsed(assetAccessParams, request.params),
        await actor(request),
      );
      if (
        !['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(
          result.version.mimeType,
        )
      )
        throw new DomainError('CONFLICT', 'This asset type has no inline preview.', 409);
      return reply
        .header('Cache-Control', 'private, no-store')
        .type(result.version.mimeType)
        .send(result.bytes);
    },
  );
  app.post(
    '/api/projects/:id/luminaires/:luminaireId/asset-versions/:versionId/file-handoff',
    async (request, reply) => {
      const params = parsed(assetAccessParams, request.params);
      const input = parsed(
        z.object({ action: z.enum(['OPEN', 'SAVE_COPY']) }).strict(),
        request.body,
      );
      const result = await resolveAssetAccess(params, await actor(request));
      return success(
        reply,
        request,
        desktopHandoffs.create({
          action: input.action === 'OPEN' ? 'OPEN_LUMINAIRE_ASSET' : 'SAVE_LUMINAIRE_ASSET_COPY',
          projectId: params.id,
          assetVersionId: params.versionId,
          managed: result.managed,
          authorizedProjectRoot: result.root,
          targetPath: result.canonical,
          fileName: result.version.fileName.replace(/^[a-f0-9]{64}[-_]/i, ''),
          fileHash: createHash('sha256').update(result.bytes).digest('hex'),
        }),
      );
    },
  );

  app.get('/api/projects/:id/luminaires/:luminaireId/asset-versions', async (request, reply) => {
    const { id, luminaireId } = request.params as { id: string; luminaireId: string };
    await service.getProject(await actor(request), id);
    return success(reply, request, personalStore.listLuminaireAssetVersions(id, luminaireId));
  });

  app.post('/api/projects/:id/luminaires/:luminaireId/asset-versions', async (request, reply) => {
    const { id, luminaireId } = request.params as { id: string; luminaireId: string };
    const requestActor = await actor(request);
    await service.getProject(requestActor, id);
    const input = parsed(attachLuminaireAssetSchema, request.body);
    const managed = await luminaireAssetStorage.admitProjectAsset({
      sourcePath: input.filePath,
      assetType: input.assetType,
      projectId: id,
      luminaireId,
    });
    try {
      return success(
        reply,
        request,
        personalStore.attachLuminaireAsset(id, luminaireId, input, requestActor, managed),
        201,
      );
    } catch (error) {
      await managed.cleanup().catch(() => undefined);
      throw error;
    }
  });

  app.delete('/api/projects/:id/luminaires/:luminaireId', async (request, reply) => {
    const { id, luminaireId } = request.params as { id: string; luminaireId: string };
    await service.getProject(await actor(request), id);
    personalStore.deleteLuminaire(id, luminaireId);
    return success(reply, request, { deleted: true });
  });

  app.patch('/api/projects/:id/lighting-package', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    await service.getProject(await actor(request), projectId);
    const input = parsed(updateLightingPackageSchema, request.body);
    return success(reply, request, personalStore.updateLightingPackage(projectId, input));
  });

  if (options.config.WORKSPACE_VARIANT === 'personal') {
    app.post('/api/projects/:id/output-presentations/preview', async (request, reply) => {
      const projectId = (request.params as { id: string }).id;
      const project = await service.getProject(await actor(request), projectId);
      if (!p4dOutputPresentationService) {
        throw new DomainError(
          'CONFLICT',
          'Professional output Preview authority is unavailable.',
          409,
        );
      }
      const input = parsed(p4dOutputPreviewSchema, request.body);
      return success(
        reply,
        request,
        await p4dOutputPresentationService.preview(
          project,
          personalStore.getWorkspace(projectId),
          input,
        ),
      );
    });

    app.post('/api/projects/:id/output-presentations/generate', async (request, reply) => {
      const projectId = (request.params as { id: string }).id;
      const requestActor = await actor(request);
      const project = await service.getProject(requestActor, projectId);
      if (!p4dOutputPresentationService) {
        throw new DomainError(
          'CONFLICT',
          'Professional output generation authority is unavailable.',
          409,
        );
      }
      const input = parsed(p4dOutputGenerateSchema, request.body);
      await projectStorageService.resolveVerifiedProjectRoot(project);
      return success(
        reply,
        request,
        await p4dOutputPresentationService.generate(
          project,
          personalStore.getWorkspace(projectId),
          requestActor,
          input,
        ),
        201,
      );
    });

    app.get('/api/projects/:id/luminaire-schedule', async (request, reply) => {
      const projectId = (request.params as { id: string }).id;
      await service.getProject(await actor(request), projectId);
      if (!luminaireScheduleOutputService) {
        throw new DomainError('CONFLICT', 'Canonical Schedule authority is unavailable.', 409);
      }
      const query = parsed(technicalScheduleWorkspaceQuerySchema, request.query);
      return success(
        reply,
        request,
        await luminaireScheduleOutputService.read(
          projectId,
          personalStore.getWorkspace(projectId),
          query.revisionId,
          query.targetRevisionId,
        ),
      );
    });

    app.patch('/api/projects/:id/luminaire-schedule/config', async (request, reply) => {
      const projectId = (request.params as { id: string }).id;
      await service.getProject(await actor(request), projectId);
      if (!luminaireScheduleOutputService) {
        throw new DomainError('CONFLICT', 'Canonical Schedule authority is unavailable.', 409);
      }
      const input = parsed(updateTechnicalScheduleConfigSchema, request.body);
      return success(reply, request, luminaireScheduleOutputService.updateConfig(projectId, input));
    });

    app.post('/api/projects/:id/luminaire-schedule/generate', async (request, reply) => {
      const projectId = (request.params as { id: string }).id;
      const requestActor = await actor(request);
      const project = await service.getProject(requestActor, projectId);
      const input = parsed(generateTechnicalScheduleSchema, request.body);
      await projectStorageService.resolveVerifiedProjectRoot(project);
      if (
        input.recoveryRevisionId &&
        studioOutputs?.ownsRevision(projectId, input.recoveryRevisionId)
      ) {
        assertPermission(
          options.config.WORKSPACE_VARIANT === 'personal' && canManageSettings(requestActor),
          'Only the Personal workspace owner can recover Studio outputs.',
        );
        return success(
          reply,
          request,
          await studioOutputs.recover(
            project,
            personalStore.getWorkspace(projectId),
            requestActor,
            input.recoveryRevisionId,
          ),
          201,
        );
      }
      if (!scheduleGenerationService) {
        throw new DomainError('CONFLICT', 'Canonical Schedule generation is unavailable.', 409);
      }
      return success(
        reply,
        request,
        await scheduleGenerationService.generateSchedule(
          project,
          personalStore.getWorkspace(projectId),
          requestActor,
          input,
        ),
        201,
      );
    });

    app.get('/api/projects/:id/technical-boq', async (request, reply) => {
      const projectId = (request.params as { id: string }).id;
      await service.getProject(await actor(request), projectId);
      if (!technicalBoqOutputService) {
        throw new DomainError('CONFLICT', 'Canonical Technical BOQ authority is unavailable.', 409);
      }
      const query = parsed(technicalBoqWorkspaceQuerySchema, request.query);
      return success(
        reply,
        request,
        await technicalBoqOutputService.read(
          projectId,
          personalStore.getWorkspace(projectId),
          query.revisionId,
          query.targetRevisionId,
        ),
      );
    });

    app.patch('/api/projects/:id/technical-boq/config', async (request, reply) => {
      const projectId = (request.params as { id: string }).id;
      await service.getProject(await actor(request), projectId);
      if (!technicalBoqOutputService) {
        throw new DomainError('CONFLICT', 'Canonical Technical BOQ authority is unavailable.', 409);
      }
      const input = parsed(updateTechnicalBoqConfigSchema, request.body);
      return success(reply, request, technicalBoqOutputService.updateConfig(projectId, input));
    });

    app.post('/api/projects/:id/technical-boq/generate', async (request, reply) => {
      const projectId = (request.params as { id: string }).id;
      const requestActor = await actor(request);
      const project = await service.getProject(requestActor, projectId);
      const input = parsed(generateTechnicalBoqSchema, request.body);
      await projectStorageService.resolveVerifiedProjectRoot(project);
      if (
        input.recoveryRevisionId &&
        studioOutputs?.ownsRevision(projectId, input.recoveryRevisionId)
      ) {
        assertPermission(
          options.config.WORKSPACE_VARIANT === 'personal' && canManageSettings(requestActor),
          'Only the Personal workspace owner can recover Studio outputs.',
        );
        return success(
          reply,
          request,
          await studioOutputs.recover(
            project,
            personalStore.getWorkspace(projectId),
            requestActor,
            input.recoveryRevisionId,
          ),
          201,
        );
      }
      if (!scheduleGenerationService) {
        throw new DomainError(
          'CONFLICT',
          'Canonical Technical BOQ generation is unavailable.',
          409,
        );
      }
      return success(
        reply,
        request,
        await scheduleGenerationService.generateBoq(
          project,
          personalStore.getWorkspace(projectId),
          requestActor,
          input,
        ),
        201,
      );
    });
  }

  app.post('/api/projects/:id/lighting-package/export', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    const requestActor = await actor(request);
    const project = await service.getProject(requestActor, projectId);
    const input = parsed(exportLightingPackageSchema, request.body);
    await projectStorageService.resolveVerifiedProjectRoot(project);
    const workspace = personalStore.getWorkspace(projectId);
    const canonicalGeneration = canonicalGenerationService
      ? await canonicalGenerationService.generate(project, workspace, requestActor, input)
      : null;
    const result = canonicalGeneration
      ? canonicalGeneration.result
      : await exportService.export(project, workspace, input);
    const record = canonicalGeneration
      ? canonicalGeneration.record
      : personalStore.recordExport(
          projectId,
          result.scheduleExcelPath,
          result.schedulePdfPath,
          result.boqExcelPath,
          result.boqPdfPath,
          result.datasheetFolder,
          input.issueStatus,
          input.issueDate,
        );
    const refreshed = personalStore.getWorkspace(projectId);
    for (const deliverable of refreshed.deliverables) {
      if (
        deliverable.serviceCode === 'LuminaireSchedule' ||
        deliverable.serviceCode === 'TechnicalBoq' ||
        deliverable.serviceCode === 'Datasheets'
      ) {
        personalStore.updateDeliverable(projectId, deliverable.id, {
          status: 'Review',
          progressPercent: 90,
        });
      }
    }
    await syncPersonalProjectProgress(projectId);
    return success(
      reply,
      request,
      {
        ...result,
        record,
        ...(canonicalGeneration
          ? {
              canonicalRevisionId: canonicalGeneration.revision.revisionId,
              canonicalOutputIds: canonicalGeneration.outputs.map((output) => output.outputId),
            }
          : {}),
      },
      201,
    );
  });

  app.patch('/api/projects/:id', async (request, reply) => {
    const input = parsed(updateProjectSchema, request.body);
    const updated = await service.updateProject(
      await actor(request),
      (request.params as { id: string }).id,
      input,
    );
    return success(reply, request, updated);
  });

  app.patch('/api/projects/:id/configuration', async (request, reply) => {
    if (options.config.WORKSPACE_VARIANT !== 'personal' || !personalProjectEditCoordinator) {
      throw new DomainError(
        'CONFIGURATION_REQUIRED',
        'Atomic Project configuration editing is available only in the Personal workspace.',
        409,
      );
    }
    const projectId = (request.params as { id: string }).id;
    const input = parsed(fullProjectEditSchema, request.body);
    const { scopeItems, luminaireInputMode, ...metadata } = input;
    const prepared = await service.prepareProjectUpdate(await actor(request), projectId, metadata);
    return success(
      reply,
      request,
      personalProjectEditCoordinator.commit(prepared, { scopeItems, luminaireInputMode }),
    );
  });

  app.get('/api/projects/:id/storage-health', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    const project = await service.getProject(await actor(request), projectId);
    return success(reply, request, await projectStorageService.getHealth(project));
  });

  app.post('/api/projects/:id/storage/reconnect', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    const project = await service.getProject(await actor(request), projectId);
    const input = parsed(reconnectProjectStorageSchema, request.body);
    return success(reply, request, await projectStorageService.reconnect(project, input));
  });

  app.post('/api/projects/:id/assign', async (request, reply) => {
    const input = parsed(assignProjectSchema, request.body);
    const updated = await service.assignProject(
      await actor(request),
      (request.params as { id: string }).id,
      input,
    );
    return success(reply, request, updated);
  });

  app.post('/api/projects/:id/status', async (request, reply) => {
    const input = parsed(changeStatusSchema, request.body);
    const updated = await service.changeStatus(
      await actor(request),
      (request.params as { id: string }).id,
      input,
    );
    return success(reply, request, updated);
  });

  app.get('/api/projects/:id/activity', async (request, reply) =>
    success(
      reply,
      request,
      await service.listActivities(await actor(request), (request.params as { id: string }).id),
    ),
  );

  // P2.6B3 — Personal workflow history read endpoint. Returns the canonical
  // immutable WorkflowTransitionRecord + RevisionCycle records for a project.
  // The timeline is a projection of these records; no write-on-read, no
  // fabricated history, no derived events. Personal-scoped: structured history
  // is Personal-first and never claims Team history.
  app.get('/api/projects/:id/workflow-history', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    // Authorize + confirm the project exists (existing not-found convention).
    await service.getProject(await actor(request), projectId);
    return success(reply, request, {
      transitions: personalStore.listWorkflowTransitions(projectId),
      revisionCycles: personalStore.listRevisionCycles(projectId),
    });
  });

  app.get('/api/projects/:id/comments', async (request, reply) =>
    success(
      reply,
      request,
      await service.listComments(await actor(request), (request.params as { id: string }).id),
    ),
  );

  app.post('/api/projects/:id/comments', async (request, reply) => {
    const input = parsed(addCommentSchema, request.body);
    const comment = await service.addComment(
      await actor(request),
      (request.params as { id: string }).id,
      input,
    );
    return success(reply, request, comment, 201);
  });

  app.get('/api/reports/summary', async (request, reply) =>
    success(reply, request, await service.reports(await actor(request))),
  );

  app.get('/api/reports/export.csv', async (request, reply) => {
    const current = await actor(request);
    assertPermission(isManager(current), 'Only Line Managers and Admins can export reports.');
    const projects = await service.listProjects(current);
    const headers = [
      'Project Code',
      'Project Name',
      'Client',
      'Sales Owner',
      'Designer',
      'Status',
      'Priority',
      'Estimated Hours',
      'Actual Hours',
      'Required Date',
      'Created At UTC',
    ];
    const rows = projects.map((project) => [
      project.projectCode,
      project.projectName,
      project.clientName,
      project.salesOwnerNameSnapshot,
      project.assignedDesignerNameSnapshot ?? '',
      project.status,
      project.priority,
      project.estimatedHours,
      project.actualHours,
      project.requiredDeliveryDate,
      project.createdAt,
    ]);
    const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', 'attachment; filename="sct-projects.csv"');
    return reply.send(`\uFEFF${csv}`);
  });

  app.get('/api/notifications', async (request, reply) => {
    const current = await actor(request);
    return success(reply, request, await options.provider.listNotifications(current.id));
  });

  app.post('/api/notifications/:id/read', async (request, reply) => {
    const current = await actor(request);
    const updated = await options.provider.markNotificationRead(
      (request.params as { id: string }).id,
      current.id,
    );
    return success(reply, request, updated);
  });

  app.post('/api/notifications/read-all', async (request, reply) => {
    const current = await actor(request);
    const unread = (await options.provider.listNotifications(current.id)).filter(
      (notification) => !notification.isRead,
    );
    await Promise.all(
      unread.map((notification) =>
        options.provider.markNotificationRead(notification.id, current.id),
      ),
    );
    return success(reply, request, { updated: unread.length });
  });

  app.get('/api/admin/settings', async (request, reply) =>
    success(reply, request, await service.getSettings(await actor(request))),
  );

  app.patch('/api/admin/settings', async (request, reply) => {
    const input = parsed(updateSettingsSchema, request.body);
    return success(reply, request, await service.updateSettings(await actor(request), input));
  });

  app.setNotFoundHandler(async (request, reply) =>
    reply.code(404).send({
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found.',
        correlationId: request.id,
      },
    }),
  );

  app.setErrorHandler(async (error, request, reply) => {
    if (error instanceof DomainError) {
      const body = {
        error: {
          code: error.code,
          message: error.message,
          correlationId: request.id,
          ...(error.details ? { details: error.details } : {}),
        },
      };
      return reply.code(error.statusCode).send(body);
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Check the submitted information and try again.',
          correlationId: request.id,
          details: { issues: error.issues },
        },
      });
    }
    request.log.error({ err: error }, 'Unhandled request error');
    return reply.code(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message:
          options.config.NODE_ENV === 'production'
            ? 'Something went wrong. Try again or contact support.'
            : error instanceof Error
              ? error.message
              : 'Unknown error',
        correlationId: request.id,
      },
    });
  });

  return app;
}
import {
  LocalVisionAdapter,
  LOCAL_VISION_MODEL,
} from './infrastructure/local-ai/LocalVisionAdapter.js';
import { LocalAiReview } from './infrastructure/local-ai/LocalAiReview.js';
import { localAiFieldSchema } from '@scli/contracts';
import { confirmDatasheetFieldSchema } from '@scli/contracts';
