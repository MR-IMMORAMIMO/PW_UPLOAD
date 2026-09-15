import type { FinalUiPreferences, UpdateFinalUiPreference } from '@scli/contracts';
import { localAiReportSchema, localAiStatusSchema, localAiPreviewSchema } from '@scli/contracts';
/**
 * Shared canonical API client.
 *
 * Non-visual, environment-agnostic client factory. All browser/tenant-specific
 * behavior (Teams SSO tokens, storage, window session events, DOM download)
 * is supplied through the injected {@link ApiClientEnvironment} seam.
 *
 * The factory returns a fully wired client: the core `apiRequest` machinery,
 * the download helpers, and the canonical `api` endpoint object. Bindings
 * (the legacy `apps/web` compatibility facade today; the future `apps/web-v4`
 * binding later) supply the environment and re-export what they need.
 */
import type {
  ApiErrorBody,
  ApiSuccess,
  CreateFolderProfileInput,
  LuminaireImportPatch,
  UpdateProjectInput,
  UpdateFolderProfileInput,
  WorkflowHistoryResponse,
  CreateProjectReviewThreadInput,
  CreateProjectReviewReplyInput,
  LinkProjectReviewDocumentInput,
  GenerateTechnicalScheduleInput,
  GenerateTechnicalBoqInput,
  P4dOutputGenerateInput,
  P4dOutputPreviewInput,
  FullProjectEditInput,
  ProjectStorageHealthResponse,
  ReconnectProjectStorageInput,
  ReconnectProjectStorageResult,
  UpdateTechnicalBoqConfigInput,
  UpdateTechnicalScheduleConfigInput,
  PrepareRevisionInput,
  DuplicateRevisionInput,
  UpdateRevisionMetadataInput,
  OpenAutomationContextInput,
  CaptureListQuery,
  CaptureListResponse,
  CaptureReadModel,
  CreateManualCaptureContextInput,
  DesktopHandoff,
  DiscardCaptureInput,
  FileHandoffInput,
  ManualCaptureContextResponse,
  StartToolSessionInput,
  StartToolSessionResponse,
  ToolSessionRead,
  UpdateOutputMappingInput,
  AddProjectLuminaireFromLibraryInput,
  CreateLuminaireLibraryAssetInput,
  CreateLuminaireLibraryAssetVersionInput,
  CreateLuminaireLibraryProductInput,
  CreateLuminaireLibraryVariantInput,
  CreateProjectLuminaireLibraryDraftInput,
  CreateLuminaireManufacturerInput,
  PublishLuminaireLibraryVariantInput,
  UpdateLuminaireLibraryProductDraftInput,
  UpdateLuminaireLibraryVariantDraftInput,
  UpdateLuminaireManufacturerInput,
  UpdateProjectLuminaireFromLibraryInput,
  UpdateProjectLuminaireDescriptionOverrideInput,
  CreateImportSessionInput,
  LegacyDatasheetAdoptionInput,
  ImportHistoryPage,
  ImportRowRead,
  ImportRowsPage,
  ImportSessionRead,
  ImportSourceTableRead,
  ReinspectImportSessionInput,
  UpdateImportTableInput,
  ReconcileImportSessionInput,
  UpdateImportRowActionInput,
  ApplyImportSessionInput,
  ImportApplyAttemptRead,
  BulkUpdateImportRowActionsInput,
  ImportLibraryGroupDecisionInput,
  CreateDocumentAdmissionInput,
  DocumentAssociationEvidenceRead,
  DocumentAdmissionRead,
  DocumentConsistencyResultRead,
  DocumentDecisionRead,
  DocumentExtractionValueRead,
  DocumentFindingRead,
  DocumentListQuery,
  DocumentRelationshipRead,
  DocumentRoutingProposalRead,
  DocumentVersionRead,
  IntelligenceDocumentRead,
  OwnerDocumentDecisionInput,
  ProcessingAttemptRead,
  PatchProjectActionInput,
  RegisterProjectSourceFileInput,
  CaptureSourceBaselineInput,
} from '@scli/contracts';
import type {
  AppNotification,
  AppSettings,
  AppUser,
  BackupRecord,
  IntegrationStatus,
  LegacyProjectImportResult,
  LegacyProjectPreview,
  LocalIntelligenceOverview,
  LocalIntelligenceFieldKey,
  LegacyDatasheetAdoptionBatchResult,
  LuminaireDatasheetBatchResult,
  LuminaireDatasheetAnalysis,
  Project,
  ProjectScopeItem,
  ProjectActivity,
  ProjectComment,
  FolderProfile,
  FolderProfilePreset,
  FolderProfileRef,
  LuminaireRecord,
  LuminaireAssetSummary,
  LuminaireAssetVersion,
  PersonalWorkspaceSettings,
  ProjectDeliverable,
  ProjectFolderIndex,
  ProjectLightingPackage,
  ProjectWorkspace,
  FolderNodePreset,
  PersonalPortfolioOperations,
  PeriodActivityReport,
  ProjectActionItem,
  ActionCategory,
  ProjectChecklistItem,
  ProjectContact,
  ProjectDocument,
  ProjectMeeting,
  MeetingParticipant,
  MeetingAgendaItem,
  MeetingNote,
  MeetingActionLink,
  MeetingListItem,
  MeetingDetail,
  ProjectOutputFolders,
  ProjectRequirement,
  ProjectReviewItem,
  ProjectReviewReply,
  ProjectReviewAttachment,
  ProjectReviewThreadContext,
  ProjectRevision,
  RevisionPackageCatalog,
  RevisionPackageComparison,
  RevisionPackageRecord,
  IssueHistoryRecord,
  PackageVerificationResult,
  ProjectType,
  ProjectTimesheet,
  ReportSummary,
  TimeEntry,
  TimeTrackingOverview,
  WorkspaceSearchResult,
  WorkloadMetrics,
  WorkSession,
  ToolContext,
  OutputTemplateSelectionRecord,
  ResolvedOutputTemplate,
  TechnicalScheduleGenerationResult,
  TechnicalScheduleWorkspaceView,
  TechnicalBoqGenerationResult,
  TechnicalBoqWorkspaceView,
  CanonicalRevisionRecord,
  PackageRevisionSummary,
  CanonicalOutputPresenceRecord,
  RevisionDeliverable,
  RevisionDocumentSnapshotRecord,
  DatasheetEligibilityItem,
  RevisionDeleteEligibility,
  RevisionDeleteResult,
  RevisionReuseEligibility,
  RevisionReuseInput,
  ResolvedOutputEnvelope,
  LuminaireLibraryAsset,
  LuminaireLibraryAssetVersion,
  LuminaireLibraryProduct,
  LuminaireLibraryVariant,
  LuminaireLibraryVariantDraft,
  LuminaireLibraryVersion,
  LuminaireManufacturer,
  ProjectLuminaireLibraryBinding,
  LuminaireLibraryVersionComparison,
  ProjectIntelligenceOverviewPayload,
  ReadinessResult,
  RevisionComparison,
  ProjectSourceFile,
  SourceFreshnessItem,
  RevisionSourceFileBaseline,
} from '@scli/domain';
import { ApiError } from './error';
import type { ApiClientEnvironment } from './environment';

// ---------------------------------------------------------------------------
// Canonical API DTO types (response shapes returned by the canonical API).
// These are non-visual contracts shared across renderers.
// ---------------------------------------------------------------------------

export type FolderProfileDefaultMatch = 'canonical' | 'factory' | 'user' | 'legacy' | 'unknown';

export interface FolderProfileCatalogView {
  schemaVersion: FolderProfile['schemaVersion'];
  profiles: FolderProfile[];
  defaultProfileRef: FolderProfileRef;
  defaultProfileId: string | null;
}

export interface FolderProfileCatalogResponse extends FolderProfileCatalogView {
  effectiveDefaultRef: FolderProfileRef;
  legacyDefaultFolderProfile: string;
  legacyDefaultMatch: FolderProfileDefaultMatch;
  legacyImportRequired: boolean;
}

export interface LuminaireImportCandidate {
  id: string;
  tag: string;
  manufacturer: string;
  model: string;
  description: string;
  wattage: string;
}

export interface LuminaireImportPreviewRow {
  rowId: string;
  status: 'Added' | 'Changed' | 'Unchanged' | 'Duplicate' | 'Ambiguous';
  matchStatus: 'None' | 'Unique' | 'Ambiguous';
  existingId: string | null;
  candidates: LuminaireImportCandidate[];
  changedFields: string[];
  record: LuminaireImportPatch;
}

export interface LuminaireLibraryPage<T> {
  items: T[];
  nextCursor: string | null;
  totalProducts?: number;
  totalVariants?: number;
  facets?: {
    manufacturers: Array<{ value: string; label: string; count: number }>;
    productTypes: Array<{ value: string; label: string; count: number }>;
    cctKelvin: Array<{ value: string; label: string; count: number }>;
    beams: Array<{ value: string; label: string; count: number }>;
    ipRatings: Array<{ value: string; label: string; count: number }>;
    controls: Array<{ value: string; label: string; count: number }>;
    mountings: Array<{ value: string; label: string; count: number }>;
  };
}
export interface LuminaireLibraryProductProjection {
  product: LuminaireLibraryProduct;
  manufacturer: LuminaireManufacturer;
  variants: Array<{
    variant: LuminaireLibraryVariant;
    latestVersion: LuminaireLibraryVersion | null;
    assetAvailability: {
      hasProductImage: boolean;
      hasDatasheet: boolean;
      hasIes: boolean;
      hasLdt: boolean;
      missingPhotometry: boolean;
      productImageAssetVersionId: string | null;
    };
  }>;
  assets?: Array<{
    asset: LuminaireLibraryAsset;
    versions: LuminaireLibraryAssetVersion[];
  }>;
}

export interface ProjectLuminaireLibraryDraftCandidate {
  eligibility: {
    eligible: boolean;
    reasonCode: 'ELIGIBLE' | 'ALREADY_LINKED';
    reason: string;
  };
  source: {
    projectId: string;
    luminaireId: string;
    manufacturerName: string;
    productName: string;
    productType: string;
    description: string;
    variant: LuminaireLibraryVariantDraft;
  };
  excludedProjectFields: Array<{
    field: 'tag' | 'category' | 'location' | 'unit' | 'quantity' | 'notes';
    label: string;
    value: string;
  }>;
  manufacturerMatches: LuminaireManufacturer[];
  duplicateSuggestions: Array<{
    strength: 'Strong' | 'Likely' | 'Possible';
    productId: string;
    productName: string;
    variantId: string | null;
    variantLabel: string | null;
    manufacturerName: string;
    orderingCode: string;
    hardConflict: boolean;
    reason: string;
  }>;
  assets: Array<{
    assetType: 'ProductImage' | 'Datasheet' | 'IES' | 'LDT';
    present: boolean;
    projectAssetVersionId: string | null;
    fileName: string | null;
    storedHash: string | null;
  }>;
}

export interface ProjectLuminaireLibraryDraftResult {
  sourceProjectId: string;
  sourceLuminaireId: string;
  manufacturer: LuminaireManufacturer;
  product: LuminaireLibraryProduct;
  variant: LuminaireLibraryVariant;
  assets: Array<{
    asset: LuminaireLibraryAsset;
    version: LuminaireLibraryAssetVersion;
    sourceProjectAssetVersionId: string;
  }>;
}
export interface ProjectLuminaireLibraryStatus {
  binding: ProjectLuminaireLibraryBinding;
  status: 'CURRENT' | 'UPDATE_AVAILABLE' | 'LIBRARY_VARIANT_ARCHIVED' | 'LIBRARY_PRODUCT_ARCHIVED';
  selectedVersionId: string;
  selectedVersionSequence: number;
  latestVersionId: string;
  latestVersionSequence: number;
}
export interface ProjectLuminaireLibraryComparison extends LuminaireLibraryVersionComparison {
  currentPublishedAt: string;
  targetPublishedAt: string;
  currentVersionSequence: number;
  targetVersionSequence: number;
}

/**
 * Build a query string from a set of optional values. Empty/undefined values
 * are omitted. Returns `''` when nothing is present, otherwise `?key=value`.
 */
export function queryString(values: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value) params.set(key, value);
  const result = params.toString();
  return result ? `?${result}` : '';
}

/**
 * Create a canonical API client bound to the given environment.
 *
 * The environment is captured at creation time and read on each request; no
 * environment callback is invoked merely by creating the client.
 */
export function createApiClient(env: ApiClientEnvironment) {
  async function requestHeaders(hasBody: boolean): Promise<Record<string, string>> {
    const headers: Record<string, string> = {};
    if (hasBody) headers['content-type'] = 'application/json';
    Object.assign(headers, await env.getAuthHeaders());
    return headers;
  }

  async function apiRequest<T>(
    path: string,
    options: {
      method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
      body?: unknown;
      signal?: AbortSignal;
    } = {},
  ): Promise<T> {
    const headers = await requestHeaders(options.body !== undefined);
    const response = await fetch(path, {
      method: options.method ?? 'GET',
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    const body = (await response.json()) as ApiSuccess<T> | ApiErrorBody;
    if (!response.ok || 'error' in body) {
      const error = 'error' in body ? body.error : undefined;
      const apiError = new ApiError(
        error?.message ?? 'The request could not be completed.',
        error?.code ?? 'REQUEST_FAILED',
        response.status,
        error?.correlationId ?? response.headers.get('x-correlation-id') ?? 'unknown',
        error?.details,
      );
      // An authenticated request (an authorization header was attached) that
      // returns 401 signals an expired session. The injected callback decides
      // the concrete behavior (e.g. legacy standalone mode clears the token
      // and dispatches `scli:session-expired`; mock mode never fires).
      if (response.status === 401 && headers.authorization !== undefined) {
        env.onSessionExpired?.();
      }
      throw apiError;
    }
    return body.data;
  }

  async function uploadImportSource(
    importSessionId: string,
    fileName: string,
    body: Blob | ArrayBuffer,
  ): Promise<ImportSessionRead> {
    const headers = await requestHeaders(false);
    headers['content-type'] = 'application/octet-stream';
    headers['x-import-file-name'] = encodeURIComponent(fileName);
    const response = await fetch(`/api/imports/${importSessionId}/source`, {
      method: 'POST',
      headers,
      body,
    });
    const payload = (await response.json()) as ApiSuccess<ImportSessionRead> | ApiErrorBody;
    if (!response.ok || 'error' in payload) {
      const error = 'error' in payload ? payload.error : undefined;
      throw new ApiError(
        error?.message ?? 'The import source could not be inspected.',
        error?.code ?? 'REQUEST_FAILED',
        response.status,
        error?.correlationId ?? response.headers.get('x-correlation-id') ?? 'unknown',
        error?.details,
      );
    }
    return payload.data;
  }

  async function uploadDocumentSource(
    fileName: string,
    body: Blob | ArrayBuffer,
    idempotencyKey: string,
    projectContextId?: string,
  ): Promise<DocumentAdmissionRead> {
    const headers = await requestHeaders(false);
    headers['content-type'] = 'application/octet-stream';
    headers['x-document-file-name'] = encodeURIComponent(fileName);
    headers['x-document-idempotency-key'] = idempotencyKey;
    if (projectContextId) headers['x-document-project-id'] = projectContextId;
    const response = await fetch('/api/documents/source', { method: 'POST', headers, body });
    const payload = (await response.json()) as ApiSuccess<DocumentAdmissionRead> | ApiErrorBody;
    if (!response.ok || 'error' in payload) {
      const error = 'error' in payload ? payload.error : undefined;
      throw new ApiError(
        error?.message ?? 'The PDF could not be admitted.',
        error?.code ?? 'REQUEST_FAILED',
        response.status,
        error?.correlationId ?? response.headers.get('x-correlation-id') ?? 'unknown',
        error?.details,
      );
    }
    return payload.data;
  }

  function triggerDownload(blob: Blob, filename: string): void {
    if (!env.downloadBlob) {
      throw new Error('This API client has no downloadBlob binding for browser downloads.');
    }
    env.downloadBlob(blob, filename);
  }

  async function downloadCsv(): Promise<void> {
    const response = await fetch('/api/reports/export.csv', {
      headers: await requestHeaders(false),
    });
    if (!response.ok) {
      throw new ApiError(
        'CSV export failed.',
        'EXPORT_FAILED',
        response.status,
        response.headers.get('x-correlation-id') ?? 'unknown',
      );
    }
    const blob = await response.blob();
    triggerDownload(blob, 'sct-projects.csv');
  }

  async function downloadPeriodActivityExcel(filters: {
    from: string;
    to: string;
    salesOwnerId?: string;
    search?: string;
  }): Promise<void> {
    const response = await fetch(
      `/api/personal/reports/activity.xlsx${queryString({
        from: filters.from,
        to: filters.to,
        salesOwnerId: filters.salesOwnerId,
        search: filters.search,
      })}`,
      { headers: await requestHeaders(false) },
    );
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
      throw new ApiError(
        body && 'error' in body ? body.error.message : 'Excel report export failed.',
        body && 'error' in body ? body.error.code : 'EXPORT_FAILED',
        response.status,
        response.headers.get('x-correlation-id') ?? 'unknown',
      );
    }
    const blob = await response.blob();
    triggerDownload(blob, `SCT_Activity_${filters.from}_${filters.to}.xlsx`);
  }

  const api = {
    localAiStatus: async () =>
      localAiStatusSchema.parse(await apiRequest<unknown>('/api/local-ai/status')),
    localAiReview: async (projectId: string, luminaireId: string) =>
      localAiReportSchema
        .nullable()
        .parse(
          await apiRequest<unknown>(
            `/api/projects/${projectId}/luminaires/${luminaireId}/local-ai`,
          ),
        ),
    startLocalAiReview: async (projectId: string, luminaireId: string) =>
      localAiReportSchema.parse(
        await apiRequest<unknown>(`/api/projects/${projectId}/luminaires/${luminaireId}/local-ai`, {
          method: 'POST',
          body: {},
        }),
      ),
    cancelLocalAiReview: (projectId: string, luminaireId: string) =>
      apiRequest<unknown>(`/api/projects/${projectId}/luminaires/${luminaireId}/local-ai/cancel`, {
        method: 'POST',
        body: {},
      }),
    localAiPage: async (projectId: string, luminaireId: string, pageNumber: number) =>
      localAiPreviewSchema.parse(
        await apiRequest<unknown>(
          `/api/projects/${projectId}/luminaires/${luminaireId}/local-ai/page?pageNumber=${pageNumber}`,
        ),
      ),
    login: (body: { email: string; password: string }) =>
      apiRequest<{ token: string; expiresInHours: number; user: AppUser }>('/api/auth/login', {
        method: 'POST',
        body,
      }),
    integrationStatus: () => apiRequest<IntegrationStatus>('/api/integration-status'),
    devUsers: () => apiRequest<AppUser[]>('/api/dev/users'),
    me: () => apiRequest<AppUser>('/api/me'),
    createImportSession: (body: CreateImportSessionInput) =>
      apiRequest<ImportSessionRead>('/api/imports', { method: 'POST', body }),
    importHistory: (query: { page?: string; limit?: string } = {}) =>
      apiRequest<ImportHistoryPage>(`/api/imports${queryString(query)}`),
    importSession: (id: string) => apiRequest<ImportSessionRead>(`/api/imports/${id}`),
    cancelImportSelection: (id: string) =>
      apiRequest<ImportSessionRead>(`/api/imports/${id}/cancel-selection`, { method: 'POST' }),
    importTables: (id: string) => apiRequest<ImportSourceTableRead[]>(`/api/imports/${id}/tables`),
    updateImportTable: (id: string, tableId: string, body: UpdateImportTableInput) =>
      apiRequest<ImportSourceTableRead>(`/api/imports/${id}/tables/${tableId}`, {
        method: 'PATCH',
        body,
      }),
    reinspectImportSession: (id: string, body: ReinspectImportSessionInput) =>
      apiRequest<ImportSessionRead>(`/api/imports/${id}/reinspect`, { method: 'POST', body }),
    importRows: (id: string, query: Record<string, string | undefined> = {}) =>
      apiRequest<ImportRowsPage>(`/api/imports/${id}/rows${queryString(query)}`),
    importRow: (id: string, rowId: string) =>
      apiRequest<ImportRowRead>(`/api/imports/${id}/rows/${rowId}`),
    reconcileImportSession: (id: string, body: ReconcileImportSessionInput) =>
      apiRequest<ImportSessionRead>(`/api/imports/${id}/reconcile`, { method: 'POST', body }),
    updateImportRowAction: (id: string, rowId: string, body: UpdateImportRowActionInput) =>
      apiRequest<ImportRowRead>(`/api/imports/${id}/rows/${rowId}/action`, {
        method: 'PATCH',
        body,
      }),
    bulkUpdateImportRowActions: (id: string, body: BulkUpdateImportRowActionsInput) =>
      apiRequest<ImportSessionRead>(`/api/imports/${id}/rows/actions`, {
        method: 'PATCH',
        body,
      }),
    decideImportLibraryGroup: (id: string, body: ImportLibraryGroupDecisionInput) =>
      apiRequest<ImportSessionRead>(`/api/imports/${id}/library-groups`, {
        method: 'PATCH',
        body,
      }),
    applyImportSession: (id: string, body: ApplyImportSessionInput) =>
      apiRequest<ImportApplyAttemptRead>(`/api/imports/${id}/apply`, { method: 'POST', body }),
    importApplyAttempts: (id: string) =>
      apiRequest<ImportApplyAttemptRead[]>(`/api/imports/${id}/apply-attempts`),
    importApplyAttempt: (id: string, attemptId: string) =>
      apiRequest<ImportApplyAttemptRead>(`/api/imports/${id}/apply-attempts/${attemptId}`),
    createImportSourceHandoff: (id: string) =>
      apiRequest<DesktopHandoff>(`/api/imports/${id}/source-handoff`, { method: 'POST' }),
    completeImportSourceHandoff: (id: string) =>
      apiRequest<ImportSessionRead>(`/api/imports/${id}/source-handoff/complete`, {
        method: 'POST',
      }),
    uploadImportSource,
    createDocumentAdmission: (body: CreateDocumentAdmissionInput) =>
      apiRequest<{ admissionId: string; handoff: DesktopHandoff }>('/api/documents/admissions', {
        method: 'POST',
        body,
      }),
    completeDocumentAdmission: (
      admissionId: string,
      body: { projectContextId?: string; idempotencyKey: string },
    ) =>
      apiRequest<DocumentAdmissionRead>(`/api/documents/admissions/${admissionId}/complete`, {
        method: 'POST',
        body,
      }),
    admitArtifactDocument: (body: {
      artifactVersionId: string;
      projectContextId?: string;
      idempotencyKey: string;
    }) =>
      apiRequest<DocumentAdmissionRead>('/api/documents/artifact-admissions', {
        method: 'POST',
        body,
      }),
    uploadDocumentSource,
    documents: (query: Partial<Record<keyof DocumentListQuery, string>> = {}) =>
      apiRequest<{
        items: IntelligenceDocumentRead[];
        totalCount: number;
        page: number;
        pageSize: number;
      }>(`/api/documents${queryString(query)}`),
    document: (documentId: string) =>
      apiRequest<IntelligenceDocumentRead>(`/api/documents/${documentId}`),
    documentVersions: (documentId: string) =>
      apiRequest<DocumentVersionRead[]>(`/api/documents/${documentId}/versions`),
    documentProcessing: (documentId: string) =>
      apiRequest<ProcessingAttemptRead>(`/api/documents/${documentId}/processing`),
    retryDocumentProcessing: (
      documentId: string,
      body: { expectedRowVersion: number; idempotencyKey: string },
    ) =>
      apiRequest<ProcessingAttemptRead>(`/api/documents/${documentId}/retry`, {
        method: 'POST',
        body,
      }),
    cancelDocumentProcessing: (documentId: string, body: { expectedRowVersion: number }) =>
      apiRequest<ProcessingAttemptRead>(`/api/documents/${documentId}/cancel`, {
        method: 'POST',
        body,
      }),
    requestDocumentManualOcr: (
      documentId: string,
      body: { expectedRowVersion: number; pageNumbers: number[] },
    ) =>
      apiRequest<ProcessingAttemptRead>(`/api/documents/${documentId}/manual-ocr`, {
        method: 'POST',
        body,
      }),
    documentEvidence: (documentId: string, page = 0, limit = 100) =>
      apiRequest<{ items: DocumentExtractionValueRead[]; totalCount: number }>(
        `/api/documents/${documentId}/evidence${queryString({ page: String(page), limit: String(limit) })}`,
      ),
    documentAssociationEvidence: (documentId: string) =>
      apiRequest<DocumentAssociationEvidenceRead[]>(
        `/api/documents/${documentId}/association-evidence`,
      ),
    documentPreview: (documentId: string, pageNumber: number) =>
      apiRequest<{
        pageNumber: number;
        width: number;
        height: number;
        mediaType: 'image/png';
        pngBase64: string;
        evidence: Array<{
          id: string;
          canonicalField: string;
          snippet: string;
          method: string;
          confidence: number;
          region: { x: number; y: number; width: number; height: number } | null;
        }>;
      }>(`/api/documents/${documentId}/preview${queryString({ pageNumber: String(pageNumber) })}`),
    documentFindings: (documentId: string) =>
      apiRequest<DocumentFindingRead[]>(`/api/documents/${documentId}/findings`),
    documentRelationships: (documentId: string) =>
      apiRequest<DocumentRelationshipRead[]>(`/api/documents/${documentId}/relationships`),
    documentDecisions: (documentId: string) =>
      apiRequest<DocumentDecisionRead[]>(`/api/documents/${documentId}/decisions`),
    decideDocument: (documentId: string, body: OwnerDocumentDecisionInput) =>
      apiRequest<IntelligenceDocumentRead>(`/api/documents/${documentId}/decisions`, {
        method: 'POST',
        body,
      }),
    recomputeDocumentConsistency: (projectId: string, idempotencyKey: string) =>
      apiRequest<DocumentConsistencyResultRead>('/api/documents/consistency/recompute', {
        method: 'POST',
        body: { projectId, idempotencyKey },
      }),
    documentRoutingProposals: (documentId: string) =>
      apiRequest<DocumentRoutingProposalRead[]>(`/api/documents/${documentId}/routing-proposals`),
    createDocumentRoutingProposal: (
      documentId: string,
      body: { expectedRowVersion: number; destinationMappingId: string },
    ) =>
      apiRequest<DocumentRoutingProposalRead>(`/api/documents/${documentId}/routing-proposals`, {
        method: 'POST',
        body,
      }),
    approveDocumentRoutingProposal: (
      documentId: string,
      proposalId: string,
      body: { expectedRowVersion: number; expectedEligibilityFingerprint: string; reason: string },
    ) =>
      apiRequest<DocumentRoutingProposalRead>(
        `/api/documents/${documentId}/routing-proposals/${proposalId}/approve`,
        { method: 'POST', body },
      ),
    executeDocumentRoutingProposal: (
      documentId: string,
      proposalId: string,
      body: { expectedRowVersion: number },
    ) =>
      apiRequest<DocumentRoutingProposalRead>(
        `/api/documents/${documentId}/routing-proposals/${proposalId}/execute`,
        { method: 'POST', body },
      ),
    luminaireLibraryManufacturers: (
      query: { search?: string; status?: string; cursor?: string; limit?: string } = {},
    ) =>
      apiRequest<LuminaireLibraryPage<LuminaireManufacturer>>(
        `/api/luminaire-library/manufacturers${queryString(query)}`,
      ),
    createLuminaireLibraryManufacturer: (body: CreateLuminaireManufacturerInput) =>
      apiRequest<LuminaireManufacturer>('/api/luminaire-library/manufacturers', {
        method: 'POST',
        body,
      }),
    updateLuminaireLibraryManufacturer: (id: string, body: UpdateLuminaireManufacturerInput) =>
      apiRequest<LuminaireManufacturer>(`/api/luminaire-library/manufacturers/${id}`, {
        method: 'PATCH',
        body,
      }),
    archiveLuminaireLibraryManufacturer: (id: string, body: unknown) =>
      apiRequest<LuminaireManufacturer>(`/api/luminaire-library/manufacturers/${id}/archive`, {
        method: 'POST',
        body,
      }),
    luminaireLibraryProducts: (query: Record<string, string | undefined> = {}) =>
      apiRequest<LuminaireLibraryPage<LuminaireLibraryProductProjection>>(
        `/api/luminaire-library/products${queryString(query)}`,
      ),
    luminaireLibraryProduct: (id: string) =>
      apiRequest<LuminaireLibraryProductProjection>(`/api/luminaire-library/products/${id}`),
    createLuminaireLibraryProduct: (body: CreateLuminaireLibraryProductInput) =>
      apiRequest<LuminaireLibraryProduct>('/api/luminaire-library/products', {
        method: 'POST',
        body,
      }),
    updateLuminaireLibraryProduct: (id: string, body: UpdateLuminaireLibraryProductDraftInput) =>
      apiRequest<LuminaireLibraryProduct>(`/api/luminaire-library/products/${id}/draft`, {
        method: 'PATCH',
        body,
      }),
    archiveLuminaireLibraryProduct: (id: string, body: unknown) =>
      apiRequest<LuminaireLibraryProduct>(`/api/luminaire-library/products/${id}/archive`, {
        method: 'POST',
        body,
      }),
    createLuminaireLibraryVariant: (productId: string, body: CreateLuminaireLibraryVariantInput) =>
      apiRequest<LuminaireLibraryVariant>(`/api/luminaire-library/products/${productId}/variants`, {
        method: 'POST',
        body,
      }),
    updateLuminaireLibraryVariant: (id: string, body: UpdateLuminaireLibraryVariantDraftInput) =>
      apiRequest<LuminaireLibraryVariant>(`/api/luminaire-library/variants/${id}/draft`, {
        method: 'PATCH',
        body,
      }),
    publishLuminaireLibraryVariant: (id: string, body: PublishLuminaireLibraryVariantInput) =>
      apiRequest<{ status: 'PUBLISHED' | 'NO_CHANGE'; version: LuminaireLibraryVersion }>(
        `/api/luminaire-library/variants/${id}/publish`,
        { method: 'POST', body },
      ),
    archiveLuminaireLibraryVariant: (id: string, body: unknown) =>
      apiRequest<LuminaireLibraryVariant>(`/api/luminaire-library/variants/${id}/archive`, {
        method: 'POST',
        body,
      }),
    luminaireLibraryVariantVersions: (id: string) =>
      apiRequest<LuminaireLibraryVersion[]>(`/api/luminaire-library/variants/${id}/versions`),
    createLuminaireLibraryAsset: (body: CreateLuminaireLibraryAssetInput) =>
      apiRequest<LuminaireLibraryAsset>('/api/luminaire-library/assets', { method: 'POST', body }),
    createLuminaireLibraryAssetVersion: (
      id: string,
      body: CreateLuminaireLibraryAssetVersionInput,
    ) =>
      apiRequest<LuminaireLibraryAssetVersion>(`/api/luminaire-library/assets/${id}/versions`, {
        method: 'POST',
        body,
      }),
    luminaireLibraryDuplicateSuggestions: (query: Record<string, string | undefined>) =>
      apiRequest<
        Array<{
          strength: 'Strong' | 'Likely' | 'Possible';
          productId: string;
          variantId: string | null;
          manufacturerName: string;
          productName: string;
          orderingCode: string;
          hardConflict: boolean;
          reason: string;
        }>
      >(`/api/luminaire-library/duplicate-suggestions${queryString(query)}`),
    datasheetImages: (projectId: string, luminaireId: string, pageNumber: number) =>
      apiRequest<DatasheetImages>(
        `/api/projects/${projectId}/luminaires/${luminaireId}/datasheet-images?pageNumber=${pageNumber}`,
      ),
    useDatasheetImage: (projectId: string, luminaireId: string, input: DatasheetImageSelection) =>
      apiRequest<unknown>(`/api/projects/${projectId}/luminaires/${luminaireId}/datasheet-images`, {
        method: 'POST',
        body: input,
      }),
    projectLuminaireLibraryDraftCandidate: (projectId: string, luminaireId: string) =>
      apiRequest<ProjectLuminaireLibraryDraftCandidate>(
        `/api/projects/${projectId}/luminaires/${luminaireId}/library-draft-candidate`,
      ),
    createProjectLuminaireLibraryDraft: (
      projectId: string,
      luminaireId: string,
      body: CreateProjectLuminaireLibraryDraftInput,
    ) =>
      apiRequest<ProjectLuminaireLibraryDraftResult>(
        `/api/projects/${projectId}/luminaires/${luminaireId}/create-library-draft`,
        { method: 'POST', body },
      ),
    addProjectLuminaireFromLibrary: (
      projectId: string,
      body: AddProjectLuminaireFromLibraryInput,
    ) =>
      apiRequest<{
        projectId: string;
        luminaireId: string;
        binding: ProjectLuminaireLibraryBinding;
      }>(`/api/projects/${projectId}/luminaires/from-library`, { method: 'POST', body }),
    projectLuminaireLibraryStatus: (projectId: string, luminaireId: string) =>
      apiRequest<ProjectLuminaireLibraryStatus>(
        `/api/projects/${projectId}/luminaires/${luminaireId}/library-status`,
      ),
    compareProjectLuminaireLibrary: (
      projectId: string,
      luminaireId: string,
      targetVersionId?: string,
    ) =>
      apiRequest<ProjectLuminaireLibraryComparison>(
        `/api/projects/${projectId}/luminaires/${luminaireId}/library-compare${queryString({ targetVersionId })}`,
      ),
    updateProjectLuminaireFromLibrary: (
      projectId: string,
      luminaireId: string,
      body: UpdateProjectLuminaireFromLibraryInput,
    ) =>
      apiRequest<{
        projectId: string;
        luminaireId: string;
        binding: ProjectLuminaireLibraryBinding;
      }>(`/api/projects/${projectId}/luminaires/${luminaireId}/update-from-library`, {
        method: 'POST',
        body,
      }),
    updateProjectLuminaireLibraryDescription: (
      projectId: string,
      luminaireId: string,
      body: UpdateProjectLuminaireDescriptionOverrideInput,
    ) =>
      apiRequest<ProjectLuminaireLibraryBinding>(
        `/api/projects/${projectId}/luminaires/${luminaireId}/library-description`,
        { method: 'PATCH', body },
      ),
    personalSettings: () => apiRequest<PersonalWorkspaceSettings>('/api/personal/settings'),
    finalUiPreferences: () => apiRequest<FinalUiPreferences>('/api/personal/ui-preferences'),
    updateFinalUiPreference: (body: UpdateFinalUiPreference) =>
      apiRequest<FinalUiPreferences>('/api/personal/ui-preferences', { method: 'PATCH', body }),
    updatePersonalSettings: (body: unknown) =>
      apiRequest<PersonalWorkspaceSettings>('/api/personal/settings', { method: 'PATCH', body }),
    personalProjectTypes: () => apiRequest<ProjectType[]>('/api/personal/project-types'),
    updatePersonalProjectTypes: (body: ProjectType[]) =>
      apiRequest<ProjectType[]>('/api/personal/project-types', { method: 'PATCH', body }),
    folderProfiles: () => apiRequest<FolderProfilePreset[]>('/api/folder-profiles'),
    saveFolderProfile: (body: {
      name: string;
      description: string;
      folders: FolderNodePreset[];
      outputFolders: ProjectOutputFolders;
    }) => apiRequest<FolderProfilePreset>('/api/folder-profiles', { method: 'POST', body }),
    folderProfileCatalog: () =>
      apiRequest<FolderProfileCatalogResponse>('/api/folder-profiles/catalog'),
    folderProfile: (profileId: string) =>
      apiRequest<FolderProfile>(`/api/folder-profiles/catalog/${profileId}`),
    createFolderProfile: (body: CreateFolderProfileInput) =>
      apiRequest<FolderProfile>('/api/folder-profiles/catalog', { method: 'POST', body }),
    updateFolderProfile: (profileId: string, body: UpdateFolderProfileInput) =>
      apiRequest<FolderProfile>(`/api/folder-profiles/catalog/${profileId}`, {
        method: 'PATCH',
        body,
      }),
    deleteFolderProfile: (profileId: string) =>
      apiRequest<{ deleted: boolean }>(`/api/folder-profiles/catalog/${profileId}`, {
        method: 'DELETE',
      }),
    setFolderProfileDefault: (ref: FolderProfileRef) =>
      apiRequest<FolderProfileCatalogView>('/api/folder-profiles/catalog/default', {
        method: 'PUT',
        body: ref,
      }),
    importLegacyFolderProfile: (name: string) =>
      apiRequest<FolderProfile>('/api/folder-profiles/catalog/import', {
        method: 'POST',
        body: { name },
      }),
    createBackup: () =>
      apiRequest<{ backupPath: string }>('/api/personal/backup', { method: 'POST' }),
    backups: () => apiRequest<BackupRecord[]>('/api/personal/backups'),
    restoreBackup: (backupPath: string) =>
      apiRequest<{ pendingPath: string; restartRequired: boolean }>(
        '/api/personal/backups/restore',
        { method: 'POST', body: { backupPath } },
      ),
    personalOperations: () => apiRequest<PersonalPortfolioOperations>('/api/personal/operations'),
    activeWorkSession: () => apiRequest<WorkSession | null>('/api/personal/work-sessions/active'),
    projectWorkSessions: (projectId: string) =>
      apiRequest<WorkSession[]>(`/api/personal/projects/${projectId}/work-sessions`),
    automationContexts: (projectId: string) =>
      apiRequest<ToolContext[]>(`/api/personal/projects/${projectId}/automation-contexts`),
    openAutomationContext: (projectId: string, body: OpenAutomationContextInput) =>
      apiRequest<ToolContext>(`/api/personal/projects/${projectId}/automation-contexts`, {
        method: 'POST',
        body,
      }),
    expireAutomationContext: (toolContextId: string) =>
      apiRequest<ToolContext>(`/api/personal/automation-contexts/${toolContextId}/expire`, {
        method: 'POST',
      }),
    rebindAutomationContext: (toolContextId: string) =>
      apiRequest<ToolContext>(`/api/personal/automation-contexts/${toolContextId}/rebind`, {
        method: 'POST',
      }),
    closeAutomationContext: (toolContextId: string) =>
      apiRequest<ToolContext>(`/api/personal/automation-contexts/${toolContextId}/close`, {
        method: 'POST',
      }),
    toolSessions: (projectId: string) =>
      apiRequest<ToolSessionRead[]>(`/api/personal/projects/${projectId}/tool-sessions`),
    startToolSession: (projectId: string, body: StartToolSessionInput) =>
      apiRequest<StartToolSessionResponse>(`/api/personal/projects/${projectId}/tool-sessions`, {
        method: 'POST',
        body,
      }),
    restartToolSession: (toolContextId: string) =>
      apiRequest<StartToolSessionResponse>(`/api/personal/tool-sessions/${toolContextId}/restart`, {
        method: 'POST',
      }),
    toolSessionExportFolderHandoff: (toolContextId: string) =>
      apiRequest<DesktopHandoff>(
        `/api/personal/tool-sessions/${toolContextId}/export-folder-handoff`,
        { method: 'POST' },
      ),
    testIntegrationLaunchHandoff: (application: 'AUTOCAD' | 'DIALUX') =>
      apiRequest<DesktopHandoff>('/api/personal/integrations/test-launch-handoff', {
        method: 'POST',
        body: { application },
      }),
    manualCaptureContext: (projectId: string, body: CreateManualCaptureContextInput) =>
      apiRequest<ManualCaptureContextResponse>(
        `/api/personal/projects/${projectId}/manual-capture-contexts`,
        { method: 'POST', body },
      ),
    captures: (projectId: string, query: Partial<CaptureListQuery> = {}) =>
      apiRequest<CaptureListResponse>(
        `/api/personal/projects/${projectId}/captures${queryString({
          view: query.view,
          application: query.application,
          state: query.state,
          toolContextId: query.toolContextId,
          limit: query.limit === undefined ? undefined : String(query.limit),
          page: query.page === undefined ? undefined : String(query.page),
          cursor: query.cursor,
        })}`,
      ),
    capture: (captureId: string) =>
      apiRequest<CaptureReadModel>(`/api/personal/captures/${captureId}`),
    retryCapture: (captureId: string) =>
      apiRequest<CaptureReadModel>(`/api/personal/captures/${captureId}/retry`, {
        method: 'POST',
        body: {},
      }),
    discardCapture: (captureId: string, body: DiscardCaptureInput) =>
      apiRequest<CaptureReadModel>(`/api/personal/captures/${captureId}/discard`, {
        method: 'POST',
        body,
      }),
    captureFileHandoff: (captureId: string, body: FileHandoffInput) =>
      apiRequest<DesktopHandoff>(`/api/personal/captures/${captureId}/file-handoff`, {
        method: 'POST',
        body,
      }),
    projectDocumentFileHandoff: (projectId: string, documentId: string, body: FileHandoffInput) =>
      apiRequest<DesktopHandoff>(
        `/api/personal/projects/${projectId}/documents/${documentId}/file-handoff`,
        { method: 'POST', body },
      ),
    updateOutputMapping: (
      projectId: string,
      outputTypeId: 'dialuxReport' | 'cadLayoutPdf' | 'cadWorkingDrawing',
      body: UpdateOutputMappingInput,
    ) =>
      apiRequest<ProjectWorkspace>(
        `/api/personal/projects/${projectId}/output-mappings/${outputTypeId}`,
        { method: 'PATCH', body },
      ),
    startWorkSession: (body: { projectId: string; idempotencyKey: string }) =>
      apiRequest<{ session: WorkSession; replayed: boolean }>('/api/personal/work-sessions/start', {
        method: 'POST',
        body,
      }),
    stopWorkSession: (body: { idempotencyKey: string }) =>
      apiRequest<{ session: WorkSession; replayed: boolean }>('/api/personal/work-sessions/stop', {
        method: 'POST',
        body,
      }),
    switchWorkSession: (body: { targetProjectId: string; idempotencyKey: string }) =>
      apiRequest<{ closed: WorkSession; active: WorkSession }>(
        '/api/personal/work-sessions/switch',
        { method: 'POST', body },
      ),
    pauseWorkSession: (body: { idempotencyKey: string }) =>
      apiRequest<{ session: WorkSession; replayed: boolean }>('/api/personal/work-sessions/pause', {
        method: 'POST',
        body,
      }),
    resumeWorkSession: (body: { idempotencyKey: string }) =>
      apiRequest<{ session: WorkSession; replayed: boolean }>(
        '/api/personal/work-sessions/resume',
        { method: 'POST', body },
      ),
    periodActivityReport: (filters: {
      from: string;
      to: string;
      salesOwnerId?: string;
      search?: string;
    }) =>
      apiRequest<PeriodActivityReport>(
        `/api/personal/reports/activity${queryString({
          from: filters.from,
          to: filters.to,
          salesOwnerId: filters.salesOwnerId,
          search: filters.search,
        })}`,
      ),
    workspaceSearch: (query: string) =>
      apiRequest<WorkspaceSearchResult[]>(
        `/api/personal/search${queryString({ q: query.trim() || undefined })}`,
      ),
    users: () => apiRequest<AppUser[]>('/api/users'),
    salesUsers: () => apiRequest<AppUser[]>('/api/users/sales'),
    createSalesContact: (body: { displayName: string; email?: string }) =>
      apiRequest<AppUser>('/api/personal/sales', { method: 'POST', body }),
    projectTypes: () => apiRequest<ProjectType[]>('/api/project-types'),
    projectTypeCatalogue: () => apiRequest<ProjectType[]>('/api/project-types/catalog'),
    workloads: () => apiRequest<WorkloadMetrics[]>('/api/designers/workload'),
    timeTrackingOverview: () => apiRequest<TimeTrackingOverview>('/api/time-tracking/overview'),
    timesheets: (filters: Record<string, string | undefined> = {}) =>
      apiRequest<ProjectTimesheet[]>(`/api/timesheets${queryString(filters)}`),
    projectTimesheets: (id: string) =>
      apiRequest<ProjectTimesheet[]>(`/api/projects/${id}/timesheets`),
    startTimer: (projectId: string, body: unknown) =>
      apiRequest<TimeEntry>(`/api/projects/${projectId}/time-entries/start`, {
        method: 'POST',
        body,
      }),
    pauseTimer: (projectId: string, entryId: string) =>
      apiRequest<TimeEntry>(`/api/projects/${projectId}/time-entries/${entryId}/pause`, {
        method: 'POST',
      }),
    resumeTimer: (projectId: string, entryId: string) =>
      apiRequest<TimeEntry>(`/api/projects/${projectId}/time-entries/${entryId}/resume`, {
        method: 'POST',
      }),
    stopTimer: (projectId: string, entryId: string) =>
      apiRequest<TimeEntry>(`/api/projects/${projectId}/time-entries/${entryId}/stop`, {
        method: 'POST',
      }),
    correctTimeEntry: (projectId: string, entryId: string, body: unknown) =>
      apiRequest<TimeEntry>(`/api/projects/${projectId}/time-entries/${entryId}`, {
        method: 'PATCH',
        body,
      }),
    submitTimesheet: (projectId: string) =>
      apiRequest<ProjectTimesheet>(`/api/projects/${projectId}/timesheets/submit`, {
        method: 'POST',
      }),
    reviewTimesheet: (
      projectId: string,
      userId: string,
      decision: 'approve' | 'reject',
      body: unknown,
    ) =>
      apiRequest<ProjectTimesheet>(`/api/projects/${projectId}/timesheets/${userId}/${decision}`, {
        method: 'POST',
        body,
      }),
    projects: (filters: Record<string, string | undefined> = {}) =>
      apiRequest<Project[]>(`/api/projects${queryString(filters)}`),
    project: (id: string) => apiRequest<Project>(`/api/projects/${id}`),
    createProject: (body: unknown) =>
      apiRequest<{
        project: Project;
        workflow: Array<{ key: string; label: string; completedAt: string }>;
        workspace?: ProjectWorkspace;
        folderCreation?: { folderPath: string; createdFolderCount: number } | null;
        folderError?: string | null;
      }>('/api/projects', { method: 'POST', body }),
    previewLegacyProjects: (rootPath: string) =>
      apiRequest<LegacyProjectPreview>('/api/personal/legacy-projects/preview', {
        method: 'POST',
        body: { rootPath },
      }),
    scanLegacyProjectFolders: (folderPaths: string[]) =>
      apiRequest<ProjectFolderIndex[]>('/api/personal/legacy-projects/scan-folders', {
        method: 'POST',
        body: { folderPaths },
      }),
    importLegacyProjects: (body: unknown) =>
      apiRequest<LegacyProjectImportResult>('/api/personal/legacy-projects/import', {
        method: 'POST',
        body,
      }),
    projectFileIndex: (id: string) =>
      apiRequest<ProjectFolderIndex>(`/api/projects/${id}/file-index`),
    scanProjectFiles: (id: string) =>
      apiRequest<ProjectFolderIndex>(`/api/projects/${id}/file-index/scan`, {
        method: 'POST',
      }),
    archiveProject: (id: string) =>
      apiRequest<Project>(`/api/projects/${id}/archive`, { method: 'POST' }),
    restoreProject: (id: string) =>
      apiRequest<Project>(`/api/projects/${id}/restore`, { method: 'POST' }),
    removeProjectFromWorkspace: (id: string, confirmation: string) =>
      apiRequest<{ removed: boolean; projectCode: string; folderUntouched: string | null }>(
        `/api/projects/${id}`,
        { method: 'DELETE', body: { confirmation } },
      ),
    projectWorkspace: (id: string) => apiRequest<ProjectWorkspace>(`/api/projects/${id}/workspace`),
    luminaireAssets: (id: string) =>
      apiRequest<LuminaireAssetSummary[]>(`/api/projects/${id}/luminaire-assets`),
    keepLuminaireProjectValue: (projectId: string, luminaireId: string, body: unknown) =>
      apiRequest<LuminaireDatasheetAnalysis>(
        `/api/projects/${projectId}/luminaires/${luminaireId}/datasheet-verification/keep-project-value`,
        { method: 'POST', body },
      ),
    revisionSnapshotFileHandoff: (projectId: string, revisionId: string, deliverableId: string) =>
      apiRequest<DesktopHandoff>(
        `/api/projects/${projectId}/revisions/${revisionId}/deliverables/${deliverableId}/file-handoff`,
        { method: 'POST', body: {} },
      ),
    luminaireAssetFileHandoff: (
      projectId: string,
      luminaireId: string,
      versionId: string,
      action: 'OPEN' | 'SAVE_COPY',
    ) =>
      apiRequest<DesktopHandoff>(
        `/api/projects/${projectId}/luminaires/${luminaireId}/asset-versions/${versionId}/file-handoff`,
        {
          method: 'POST',
          body: { action },
        },
      ),
    luminaireAssetVersions: (projectId: string, luminaireId: string) =>
      apiRequest<LuminaireAssetVersion[]>(
        `/api/projects/${projectId}/luminaires/${luminaireId}/asset-versions`,
      ),
    attachLuminaireAsset: (projectId: string, luminaireId: string, body: unknown) =>
      apiRequest<LuminaireAssetVersion>(
        `/api/projects/${projectId}/luminaires/${luminaireId}/asset-versions`,
        { method: 'POST', body },
      ),
    localIntelligence: (id: string) =>
      apiRequest<LocalIntelligenceOverview>(`/api/projects/${id}/local-intelligence`),
    projectDatasheetResults: (id: string) =>
      apiRequest<LuminaireDatasheetBatchResult | null>(
        `/api/projects/${id}/local-intelligence/datasheet-results`,
      ),
    analyzeProjectDatasheets: (id: string) =>
      apiRequest<LuminaireDatasheetBatchResult>(
        `/api/projects/${id}/local-intelligence/analyze-datasheets`,
        { method: 'POST' },
      ),
    legacyDatasheetAdoptionStatus: (id: string) =>
      apiRequest<LegacyDatasheetAdoptionBatchResult>(
        `/api/projects/${id}/legacy-datasheet-adoption`,
      ),
    adoptLegacyDatasheets: (id: string, body: LegacyDatasheetAdoptionInput) =>
      apiRequest<LegacyDatasheetAdoptionBatchResult>(
        `/api/projects/${id}/legacy-datasheet-adoption`,
        { method: 'POST', body },
      ),
    analyzeLuminaireDatasheet: (projectId: string, luminaireId: string) =>
      apiRequest<LuminaireDatasheetAnalysis>(
        `/api/projects/${projectId}/luminaires/${luminaireId}/analyze-datasheet`,
        { method: 'POST' },
      ),
    resolveLuminaireDatasheetField: (
      projectId: string,
      luminaireId: string,
      body: {
        fieldKey: LocalIntelligenceFieldKey;
        expectedRowVersion: number;
        verificationFingerprint: string;
      },
    ) =>
      apiRequest<LuminaireDatasheetAnalysis>(
        `/api/projects/${projectId}/luminaires/${luminaireId}/datasheet-verification/field`,
        { method: 'PATCH', body },
      ),
    confirmLuminaireDatasheetField: (
      projectId: string,
      luminaireId: string,
      body: ConfirmDatasheetFieldInput,
    ) =>
      apiRequest<LuminaireDatasheetAnalysis>(
        `/api/projects/${projectId}/luminaires/${luminaireId}/datasheet-verification/confirm`,
        { method: 'POST', body },
      ),
    revisionPackageCatalog: (id: string, revisionId?: string) =>
      apiRequest<RevisionPackageCatalog>(
        `/api/projects/${id}/revision-package-catalog${revisionId ? `?revisionId=${encodeURIComponent(revisionId)}` : ''}`,
      ),
    createRevisionPackage: (id: string, body: unknown) =>
      apiRequest<RevisionPackageRecord>(`/api/projects/${id}/revision-packages`, {
        method: 'POST',
        body,
      }),
    compareRevisionPackages: (projectId: string, from: string, to: string) =>
      apiRequest<RevisionPackageComparison>(
        `/api/projects/${projectId}/revision-packages/compare${queryString({ from, to })}`,
      ),
    libraryAssetFileHandoff: (assetVersionId: string) =>
      apiRequest<DesktopHandoff>(
        `/api/luminaire-library/assets/versions/${assetVersionId}/file-handoff`,
        { method: 'POST', body: {} },
      ),
    packageFileHandoff: (projectId: string, packageId: string, deliverableId: string) =>
      apiRequest<DesktopHandoff>(
        `/api/projects/${projectId}/issue-packages/${packageId}/deliverables/${deliverableId}/file-handoff`,
        { method: 'POST', body: {} },
      ),
    packageFile: async (projectId: string, packageId: string, memberId?: string) => {
      const response = await fetch(
        `/api/projects/${projectId}/issue-packages/${packageId}/file${memberId ? `?memberId=${encodeURIComponent(memberId)}` : ''}`,
        { headers: await requestHeaders(false) },
      );
      if (!response.ok) {
        const payload = (await response.json()) as ApiErrorBody;
        throw new Error(payload.error?.message ?? 'The saved package file is unavailable.');
      }
      return response.blob();
    },
    issueHistory: (projectId: string) =>
      apiRequest<{ items: IssueHistoryRecord[] }>(`/api/projects/${projectId}/issue-history`),
    verifyIssuePackage: (projectId: string, packageId: string) =>
      apiRequest<PackageVerificationResult>(
        `/api/projects/${projectId}/issue-packages/${packageId}/verify`,
      ),
    createProjectFolders: (id: string, body: unknown) =>
      apiRequest<{ folderPath: string; createdFolderCount: number }>(
        `/api/projects/${id}/create-folders`,
        { method: 'POST', body },
      ),
    updateProjectWorkspaceSetup: (id: string, body: unknown) =>
      apiRequest<{ workspace: ProjectWorkspace; createdFolderCount: number }>(
        `/api/projects/${id}/workspace-setup`,
        { method: 'PATCH', body },
      ),
    previewLuminaireImport: (projectId: string, body: unknown) =>
      apiRequest<{ source: 'AutoCadCsv' | 'DialuxCsv'; rows: LuminaireImportPreviewRow[] }>(
        `/api/projects/${projectId}/luminaires/import-preview`,
        { method: 'POST', body },
      ),
    commitLuminaireImport: (projectId: string, body: unknown) =>
      apiRequest<{ added: number; updated: number; ignored: number }>(
        `/api/projects/${projectId}/luminaires/import-commit`,
        { method: 'POST', body },
      ),
    updateDeliverable: (projectId: string, deliverableId: string, body: unknown) =>
      apiRequest<ProjectDeliverable>(`/api/projects/${projectId}/deliverables/${deliverableId}`, {
        method: 'PATCH',
        body,
      }),
    createRequirement: (projectId: string, body: unknown) =>
      apiRequest<ProjectRequirement>(`/api/projects/${projectId}/requirements`, {
        method: 'POST',
        body,
      }),
    updateRequirement: (projectId: string, itemId: string, body: unknown) =>
      apiRequest<ProjectRequirement>(`/api/projects/${projectId}/requirements/${itemId}`, {
        method: 'PATCH',
        body,
      }),
    deleteRequirement: (projectId: string, itemId: string) =>
      apiRequest<{ deleted: boolean }>(`/api/projects/${projectId}/requirements/${itemId}`, {
        method: 'DELETE',
      }),
    createChecklistItem: (projectId: string, body: unknown) =>
      apiRequest<ProjectChecklistItem>(`/api/projects/${projectId}/checklist`, {
        method: 'POST',
        body,
      }),
    updateChecklistItem: (projectId: string, itemId: string, body: unknown) =>
      apiRequest<ProjectChecklistItem>(`/api/projects/${projectId}/checklist/${itemId}`, {
        method: 'PATCH',
        body,
      }),
    createAction: (projectId: string, body: unknown) =>
      apiRequest<ProjectActionItem>(`/api/projects/${projectId}/actions`, {
        method: 'POST',
        body,
      }),
    updateAction: (projectId: string, itemId: string, body: unknown) =>
      apiRequest<ProjectActionItem>(`/api/projects/${projectId}/actions/${itemId}`, {
        method: 'PATCH',
        body,
      }),
    listActionCategories: () => apiRequest<ActionCategory[]>('/api/action-categories'),
    createActionCategory: (body: unknown) =>
      apiRequest<ActionCategory>('/api/action-categories', { method: 'POST', body }),
    updateActionCategory: (categoryId: string, body: unknown) =>
      apiRequest<ActionCategory>(`/api/action-categories/${categoryId}`, { method: 'PATCH', body }),
    deleteActionCategory: (categoryId: string) =>
      apiRequest<{ deleted: boolean }>(`/api/action-categories/${categoryId}`, {
        method: 'DELETE',
      }),
    replaceAndDeleteActionCategory: (categoryId: string, replacementId: string | null) =>
      apiRequest<{ deleted: boolean }>(`/api/action-categories/${categoryId}`, {
        method: 'DELETE',
        body: { replacementId },
      }),
    createMeeting: (projectId: string, body: unknown) =>
      apiRequest<ProjectMeeting>(`/api/projects/${projectId}/meetings`, {
        method: 'POST',
        body,
      }),
    updateMeeting: (projectId: string, itemId: string, body: unknown) =>
      apiRequest<ProjectMeeting>(`/api/projects/${projectId}/meetings/${itemId}`, {
        method: 'PATCH',
        body,
      }),
    listMeetings: (projectId: string) =>
      apiRequest<MeetingListItem[]>(`/api/projects/${projectId}/meetings`),
    getMeetingDetail: (projectId: string, meetingId: string) =>
      apiRequest<MeetingDetail>(`/api/projects/${projectId}/meetings/${meetingId}`),
    listMeetingParticipants: (projectId: string, meetingId: string) =>
      apiRequest<MeetingParticipant[]>(
        `/api/projects/${projectId}/meetings/${meetingId}/participants`,
      ),
    listMeetingAgendaItems: (projectId: string, meetingId: string) =>
      apiRequest<MeetingAgendaItem[]>(
        `/api/projects/${projectId}/meetings/${meetingId}/agenda-items`,
      ),
    listMeetingNotes: (projectId: string, meetingId: string) =>
      apiRequest<MeetingNote[]>(`/api/projects/${projectId}/meetings/${meetingId}/notes`),
    createMeetingNote: (projectId: string, meetingId: string, body: unknown) =>
      apiRequest<MeetingNote>(`/api/projects/${projectId}/meetings/${meetingId}/notes`, {
        method: 'POST',
        body,
      }),
    updateMeetingNote: (projectId: string, meetingId: string, noteId: string, body: unknown) =>
      apiRequest<MeetingNote>(`/api/projects/${projectId}/meetings/${meetingId}/notes/${noteId}`, {
        method: 'PATCH',
        body,
      }),
    deleteMeetingNote: (projectId: string, meetingId: string, noteId: string) =>
      apiRequest<{ deleted: boolean }>(
        `/api/projects/${projectId}/meetings/${meetingId}/notes/${noteId}`,
        { method: 'DELETE' },
      ),
    listMeetingActionLinks: (projectId: string, meetingId: string) =>
      apiRequest<MeetingActionLink[]>(
        `/api/projects/${projectId}/meetings/${meetingId}/action-links`,
      ),
    linkMeetingAction: (projectId: string, meetingId: string, body: { actionId: string }) =>
      apiRequest<MeetingActionLink>(
        `/api/projects/${projectId}/meetings/${meetingId}/action-links`,
        { method: 'POST', body },
      ),
    unlinkMeetingAction: (projectId: string, meetingId: string, actionId: string) =>
      apiRequest<{ deleted: boolean }>(
        `/api/projects/${projectId}/meetings/${meetingId}/action-links/${actionId}`,
        { method: 'DELETE' },
      ),
    listActionMeetingLinks: (projectId: string, actionId: string) =>
      apiRequest<MeetingActionLink[]>(
        `/api/projects/${projectId}/actions/${actionId}/meeting-links`,
      ),
    createActionFromMeeting: (projectId: string, meetingId: string, body: unknown) =>
      apiRequest<ProjectActionItem>(`/api/projects/${projectId}/meetings/${meetingId}/actions`, {
        method: 'POST',
        body,
      }),
    createReviewItem: (projectId: string, body: unknown) =>
      apiRequest<ProjectReviewItem>(`/api/projects/${projectId}/review-items`, {
        method: 'POST',
        body,
      }),
    updateReviewItem: (projectId: string, itemId: string, body: unknown) =>
      apiRequest<ProjectReviewItem>(`/api/projects/${projectId}/review-items/${itemId}`, {
        method: 'PATCH',
        body,
      }),
    createReviewThread: (projectId: string, body: CreateProjectReviewThreadInput) =>
      apiRequest<ProjectReviewItem>(`/api/projects/${projectId}/review-threads`, {
        method: 'POST',
        body,
      }),
    listReviewThreadContext: (projectId: string) =>
      apiRequest<ProjectReviewThreadContext>(`/api/projects/${projectId}/review-thread-context`),
    createReviewReply: (
      projectId: string,
      reviewItemId: string,
      body: CreateProjectReviewReplyInput,
    ) =>
      apiRequest<ProjectReviewReply>(
        `/api/projects/${projectId}/review-items/${reviewItemId}/replies`,
        { method: 'POST', body },
      ),
    updateReviewReply: (
      projectId: string,
      reviewItemId: string,
      replyId: string,
      body: { body: string; expectedUpdatedAt: string },
    ) =>
      apiRequest<ProjectReviewReply>(
        `/api/projects/${projectId}/review-items/${reviewItemId}/replies/${replyId}`,
        { method: 'PATCH', body },
      ),
    linkReviewItemDocument: (
      projectId: string,
      reviewItemId: string,
      body: LinkProjectReviewDocumentInput,
    ) =>
      apiRequest<ProjectReviewAttachment>(
        `/api/projects/${projectId}/review-items/${reviewItemId}/attachments`,
        { method: 'POST', body },
      ),
    linkReviewReplyDocument: (
      projectId: string,
      reviewItemId: string,
      replyId: string,
      body: LinkProjectReviewDocumentInput,
    ) =>
      apiRequest<ProjectReviewAttachment>(
        `/api/projects/${projectId}/review-items/${reviewItemId}/replies/${replyId}/attachments`,
        { method: 'POST', body },
      ),
    createRevision: (projectId: string, body: unknown) =>
      apiRequest<ProjectRevision>(`/api/projects/${projectId}/revisions`, {
        method: 'POST',
        body,
      }),
    updateRevision: (projectId: string, itemId: string, body: unknown) =>
      apiRequest<ProjectRevision>(`/api/projects/${projectId}/revisions/${itemId}`, {
        method: 'PATCH',
        body,
      }),
    createDocument: (projectId: string, body: unknown) =>
      apiRequest<ProjectDocument>(`/api/projects/${projectId}/documents`, {
        method: 'POST',
        body,
      }),
    updateDocument: (projectId: string, itemId: string, body: unknown) =>
      apiRequest<ProjectDocument>(`/api/projects/${projectId}/documents/${itemId}`, {
        method: 'PATCH',
        body,
      }),
    removeDocument: (projectId: string, itemId: string) =>
      apiRequest<{ removed: boolean }>(`/api/projects/${projectId}/documents/${itemId}`, {
        method: 'DELETE',
      }),
    createContact: (projectId: string, body: unknown) =>
      apiRequest<ProjectContact>(`/api/projects/${projectId}/contacts`, {
        method: 'POST',
        body,
      }),
    updateContact: (projectId: string, itemId: string, body: unknown) =>
      apiRequest<ProjectContact>(`/api/projects/${projectId}/contacts/${itemId}`, {
        method: 'PATCH',
        body,
      }),
    projectStudio: (projectId: string) =>
      apiRequest<{
        document: import('@scli/contracts').StudioDocument;
        version: number;
        fingerprint: string;
      }>(`/api/projects/${projectId}/luminaire-studio`),
    addLuminaire: (projectId: string, body: unknown) =>
      apiRequest<LuminaireRecord>(`/api/projects/${projectId}/luminaires`, {
        method: 'POST',
        body,
      }),
    updateProjectTechnicalField: (
      projectId: string,
      luminaireId: string,
      body: import('@scli/contracts').EditProjectTechnicalFieldInput,
    ) =>
      apiRequest<LuminaireRecord>(
        `/api/projects/${projectId}/luminaires/${luminaireId}/technical-field`,
        { method: 'PATCH', body },
      ),
    updateLuminaire: (projectId: string, luminaireId: string, body: unknown) =>
      apiRequest<LuminaireRecord>(`/api/projects/${projectId}/luminaires/${luminaireId}`, {
        method: 'PATCH',
        body,
      }),
    deleteLuminaire: (projectId: string, luminaireId: string) =>
      apiRequest<{ deleted: boolean }>(`/api/projects/${projectId}/luminaires/${luminaireId}`, {
        method: 'DELETE',
      }),
    updateLightingPackage: (projectId: string, body: unknown) =>
      apiRequest<ProjectLightingPackage>(`/api/projects/${projectId}/lighting-package`, {
        method: 'PATCH',
        body,
      }),
    luminaireScheduleWorkspace: (
      projectId: string,
      revisionId?: string,
      targetRevisionId?: string,
    ) =>
      apiRequest<TechnicalScheduleWorkspaceView>(
        `/api/projects/${projectId}/luminaire-schedule${queryString({ revisionId, targetRevisionId })}`,
      ),
    updateLuminaireScheduleConfig: (projectId: string, body: UpdateTechnicalScheduleConfigInput) =>
      apiRequest<{
        projectOverride: OutputTemplateSelectionRecord;
        effectiveTemplate: ResolvedOutputTemplate;
      }>(`/api/projects/${projectId}/luminaire-schedule/config`, {
        method: 'PATCH',
        body,
      }),
    generateLuminaireSchedule: (projectId: string, body: GenerateTechnicalScheduleInput) =>
      apiRequest<TechnicalScheduleGenerationResult>(
        `/api/projects/${projectId}/luminaire-schedule/generate`,
        { method: 'POST', body },
      ),
    technicalBoqWorkspace: (projectId: string, revisionId?: string, targetRevisionId?: string) =>
      apiRequest<TechnicalBoqWorkspaceView>(
        `/api/projects/${projectId}/technical-boq${queryString({ revisionId, targetRevisionId })}`,
      ),
    updateTechnicalBoqConfig: (projectId: string, body: UpdateTechnicalBoqConfigInput) =>
      apiRequest<{
        projectOverride: OutputTemplateSelectionRecord;
        effectiveTemplate: ResolvedOutputTemplate;
      }>(`/api/projects/${projectId}/technical-boq/config`, {
        method: 'PATCH',
        body,
      }),
    generateTechnicalBoq: (projectId: string, body: GenerateTechnicalBoqInput) =>
      apiRequest<TechnicalBoqGenerationResult>(
        `/api/projects/${projectId}/technical-boq/generate`,
        { method: 'POST', body },
      ),
    previewP4dOutput: (projectId: string, body: P4dOutputPreviewInput) =>
      apiRequest<ResolvedOutputEnvelope>(
        `/api/projects/${projectId}/output-presentations/preview`,
        {
          method: 'POST',
          body,
        },
      ),
    generateP4dOutput: (projectId: string, body: P4dOutputGenerateInput) =>
      apiRequest<TechnicalScheduleGenerationResult>(
        `/api/projects/${projectId}/output-presentations/generate`,
        { method: 'POST', body },
      ),
    exportLightingPackage: (projectId: string, body: unknown) =>
      apiRequest<{
        excelPath: string;
        pdfPath: string;
        scheduleExcelPath: string;
        schedulePdfPath: string;
        boqExcelPath: string;
        boqPdfPath: string;
        datasheetFolder: string;
        datasheetCount: number;
        outputFolder: string;
      }>(`/api/projects/${projectId}/lighting-package/export`, { method: 'POST', body }),
    updateProject: (id: string, body: UpdateProjectInput) =>
      apiRequest<Project>(`/api/projects/${id}`, { method: 'PATCH', body }),
    updateProjectConfiguration: (id: string, body: FullProjectEditInput) =>
      apiRequest<{
        project: Project;
        workspace: ProjectWorkspace & { scopeItems: ProjectScopeItem[] };
      }>(`/api/projects/${id}/configuration`, { method: 'PATCH', body }),
    projectStorageHealth: (id: string) =>
      apiRequest<ProjectStorageHealthResponse>(`/api/projects/${id}/storage-health`),
    reconnectProjectStorage: (id: string, body: ReconnectProjectStorageInput) =>
      apiRequest<ReconnectProjectStorageResult>(`/api/projects/${id}/storage/reconnect`, {
        method: 'POST',
        body,
      }),
    assignProject: (id: string, body: unknown) =>
      apiRequest<Project>(`/api/projects/${id}/assign`, { method: 'POST', body }),
    changeStatus: (id: string, body: unknown) =>
      apiRequest<Project>(`/api/projects/${id}/status`, { method: 'POST', body }),
    activities: (id: string) => apiRequest<ProjectActivity[]>(`/api/projects/${id}/activity`),
    workflowHistory: (id: string) =>
      apiRequest<WorkflowHistoryResponse>(`/api/projects/${id}/workflow-history`),
    comments: (id: string) => apiRequest<ProjectComment[]>(`/api/projects/${id}/comments`),
    addComment: (id: string, body: unknown) =>
      apiRequest<ProjectComment>(`/api/projects/${id}/comments`, { method: 'POST', body }),
    reportSummary: () => apiRequest<ReportSummary>('/api/reports/summary'),
    downloadCsv,
    notifications: () => apiRequest<AppNotification[]>('/api/notifications'),
    markNotificationRead: (id: string) =>
      apiRequest<AppNotification>(`/api/notifications/${id}/read`, { method: 'POST' }),
    markAllNotificationsRead: () =>
      apiRequest<{ updated: number }>('/api/notifications/read-all', { method: 'POST' }),
    settings: () => apiRequest<AppSettings>('/api/admin/settings'),
    updateSettings: (body: unknown) =>
      apiRequest<AppSettings>('/api/admin/settings', { method: 'PATCH', body }),
    updateUser: (id: string, body: unknown) =>
      apiRequest<AppUser>(`/api/admin/users/${id}`, { method: 'PATCH', body }),
    createUser: (body: unknown) =>
      apiRequest<AppUser>('/api/admin/users', { method: 'POST', body }),
    resetPassword: (id: string, body: unknown) =>
      apiRequest<{ reset: boolean }>(`/api/admin/users/${id}/password`, {
        method: 'POST',
        body,
      }),
    projectRevisions: (projectId: string) =>
      apiRequest<CanonicalRevisionRecord[]>(`/api/projects/${projectId}/revisions`),
    packageRevisions: (projectId: string) =>
      apiRequest<PackageRevisionSummary[]>(`/api/projects/${projectId}/package-revisions`),
    projectOutputs: (projectId: string) =>
      apiRequest<CanonicalOutputPresenceRecord[]>(`/api/projects/${projectId}/outputs`),
    prepareRevision: (projectId: string, body: PrepareRevisionInput = {}) =>
      apiRequest<CanonicalRevisionRecord>(`/api/projects/${projectId}/revisions/prepare`, {
        method: 'POST',
        body,
      }),
    duplicateRevision: (projectId: string, revisionId: string, body: DuplicateRevisionInput) =>
      apiRequest<CanonicalRevisionRecord>(
        `/api/projects/${projectId}/revisions/${revisionId}/duplicate`,
        { method: 'POST', body },
      ),
    updateRevisionMetadata: (
      projectId: string,
      revisionId: string,
      body: UpdateRevisionMetadataInput,
    ) =>
      apiRequest<CanonicalRevisionRecord>(
        `/api/projects/${projectId}/revisions/${revisionId}/metadata`,
        { method: 'PATCH', body },
      ),
    revisionDeliverables: (projectId: string, revisionId: string) =>
      apiRequest<RevisionDeliverable[]>(
        `/api/projects/${projectId}/revisions/${revisionId}/deliverables`,
      ),
    /**
     * PACKAGES-E2E-05A — project/revision-scoped Datasheet intake eligibility.
     * Read-only classification of every Datasheet AssetVersion.
     */
    datasheetEligibility: (projectId: string, revisionId: string) =>
      apiRequest<DatasheetEligibilityItem[]>(
        `/api/projects/${projectId}/revisions/${revisionId}/datasheet-eligibility`,
      ),
    /**
     * PACKAGES-E2E-05A — admit one Datasheet AssetVersion as an immutable
     * Datasheet DocumentSnapshot of the target PREPARING Revision. Body is
     * `{ assetVersionId }` only; the server re-resolves everything.
     */
    addDatasheetDeliverable: (projectId: string, revisionId: string, body: unknown) =>
      apiRequest<RevisionDocumentSnapshotRecord>(
        `/api/projects/${projectId}/revisions/${revisionId}/datasheet-deliverables`,
        { method: 'POST', body },
      ),
    addRevisionDeliverable: (projectId: string, revisionId: string, body: unknown) =>
      apiRequest<RevisionDocumentSnapshotRecord>(
        `/api/projects/${projectId}/revisions/${revisionId}/deliverables`,
        { method: 'POST', body },
      ),
    removeRevisionDeliverable: (projectId: string, revisionId: string, deliverableId: string) =>
      apiRequest<{ ok: boolean }>(
        `/api/projects/${projectId}/revisions/${revisionId}/deliverables/${deliverableId}`,
        { method: 'DELETE' },
      ),
    finalizeRevision: (projectId: string, revisionId: string) =>
      apiRequest<CanonicalRevisionRecord>(
        `/api/projects/${projectId}/revisions/${revisionId}/finalize`,
        { method: 'POST' },
      ),
    /**
     * C0 — repairs a damaged composed manual Revision draft
     * (FAILED_RECOVERABLE -> PREPARING). Identity travels in the path only;
     * lifecycle and provenance remain server authority, so there is no body.
     */
    resumeRevision: (projectId: string, revisionId: string) =>
      apiRequest<CanonicalRevisionRecord>(
        `/api/projects/${projectId}/revisions/${revisionId}/resume`,
        { method: 'POST' },
      ),
    /**
     * P2C-03 — server-authoritative Revision Delete eligibility. The UI never
     * invents delete eligibility; it only offers the Delete action based on
     * this read, and the mutation re-runs the full check server-side.
     */
    revisionDeleteEligibility: (projectId: string, revisionId: string) =>
      apiRequest<RevisionDeleteEligibility>(
        `/api/projects/${projectId}/revisions/${revisionId}/delete-eligibility`,
      ),
    /**
     * P2C-03 — Safe Revision Delete mutation. Server re-runs the complete
     * eligibility check, archives owned artifacts, then commits the DB
     * deletion atomically. Returns the durable delete operation result.
     */
    deleteRevision: (projectId: string, revisionId: string) =>
      apiRequest<RevisionDeleteResult>(`/api/projects/${projectId}/revisions/${revisionId}`, {
        method: 'DELETE',
      }),
    /** P2C-04 — at most one server-derived immediate number-reuse candidate. */
    revisionReuseEligibility: (projectId: string) =>
      apiRequest<RevisionReuseEligibility>(
        `/api/projects/${projectId}/revisions/reuse-eligibility`,
      ),
    /** P2C-04 — explicit claim; the client supplies no sequence or new identity. */
    reuseRevisionNumber: (projectId: string, body: RevisionReuseInput) =>
      apiRequest<CanonicalRevisionRecord>(`/api/projects/${projectId}/revisions/reuse`, {
        method: 'POST',
        body,
      }),
    // ---------------------------------------------------------------------
    // P5D — Project Intelligence & Productivity
    // ---------------------------------------------------------------------
    projectIntelligence: (projectId: string) =>
      apiRequest<ProjectIntelligenceOverviewPayload>(`/api/projects/${projectId}/intelligence`),
    projectReadiness: (projectId: string, revisionId: string) =>
      apiRequest<ReadinessResult>(`/api/projects/${projectId}/readiness?revisionId=${revisionId}`),
    projectRevisionComparison: (projectId: string, fromRevisionId: string, toRevisionId: string) =>
      apiRequest<RevisionComparison>(
        `/api/projects/${projectId}/revision-comparison?fromRevisionId=${fromRevisionId}&toRevisionId=${toRevisionId}`,
      ),
    patchProjectAction: (projectId: string, actionId: string, body: PatchProjectActionInput) =>
      apiRequest<ProjectActionItem>(`/api/projects/${projectId}/actions/${actionId}/merge`, {
        method: 'PATCH',
        body,
      }),
    projectSourceFiles: (projectId: string) =>
      apiRequest<ProjectSourceFile[]>(`/api/projects/${projectId}/source-files`),
    selectProjectSourceHandoff: (projectId: string) =>
      apiRequest<{ admissionId: string; handoff: DesktopHandoff }>(
        `/api/projects/${projectId}/source-files/select-handoff`,
        { method: 'POST' },
      ),
    registerProjectSourceFile: (projectId: string, body: RegisterProjectSourceFileInput) =>
      apiRequest<ProjectSourceFile>(`/api/projects/${projectId}/source-files`, {
        method: 'POST',
        body,
      }),
    deleteProjectSourceFile: (projectId: string, sourceId: string) =>
      apiRequest<{ deleted: boolean }>(`/api/projects/${projectId}/source-files/${sourceId}`, {
        method: 'DELETE',
      }),
    checkProjectSourceFreshness: (projectId: string, sourceId: string, revisionId: string) =>
      apiRequest<SourceFreshnessItem & { revisionLabel: string | null }>(
        `/api/projects/${projectId}/source-files/${sourceId}/check?revisionId=${revisionId}`,
        { method: 'POST' },
      ),
    projectSourceFreshness: (projectId: string, revisionId: string) =>
      apiRequest<SourceFreshnessItem[]>(
        `/api/projects/${projectId}/source-files/freshness?revisionId=${revisionId}`,
      ),
    captureProjectSourceBaseline: (
      projectId: string,
      revisionId: string,
      body: CaptureSourceBaselineInput,
    ) =>
      apiRequest<{ baseline: RevisionSourceFileBaseline; revisionLabel: string | null }>(
        `/api/projects/${projectId}/revisions/${revisionId}/source-baselines`,
        { method: 'POST', body },
      ),
    projectSourceBaselines: (projectId: string, revisionId: string) =>
      apiRequest<RevisionSourceFileBaseline[]>(
        `/api/projects/${projectId}/revisions/${revisionId}/source-baselines`,
      ),
  };

  return { apiRequest, downloadCsv, downloadPeriodActivityExcel, api };
}

export type { ApiClientEnvironment, ApiClientStorage } from './environment';
import type { DatasheetImages, DatasheetImageSelection } from '@scli/contracts';
import type { ConfirmDatasheetFieldInput } from '@scli/contracts';
