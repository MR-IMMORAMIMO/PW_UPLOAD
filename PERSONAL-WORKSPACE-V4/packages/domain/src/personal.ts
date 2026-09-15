export const workspaceVariants = ['personal', 'team'] as const;
export type WorkspaceVariant = (typeof workspaceVariants)[number];

export const projectServiceCodes = [
  'LightingLayout',
  'LightingDesign',
  'DialuxCalculation',
  'DialuxReport',
  'Visualization3D',
  'Presentation',
  'LuminaireSchedule',
  'TechnicalBoq',
  'Datasheets',
  'Custom',
] as const;
export type ProjectServiceCode = (typeof projectServiceCodes)[number];

export const deliverableStatuses = [
  'NotStarted',
  'InProgress',
  'Waiting',
  'Review',
  'Completed',
  'NotRequired',
] as const;
export type DeliverableStatus = (typeof deliverableStatuses)[number];

export const luminaireInputModes = ['Manual', 'AutoCadCsv', 'DialuxCsv', 'Later'] as const;
export type LuminaireInputMode = (typeof luminaireInputModes)[number];

export const luminaireInputModeOptions = [
  {
    value: 'Later',
    label: 'Ask per project',
    detail: 'Create the project now and choose the source when ready.',
  },
  {
    value: 'Manual',
    label: 'Manual',
    detail: 'Add each luminaire directly inside the project.',
  },
  {
    value: 'AutoCadCsv',
    label: 'AutoCAD CSV',
    detail: 'Import tags and quantities exported from AutoCAD.',
  },
  {
    value: 'DialuxCsv',
    label: 'DIALux CSV',
    detail: 'Import a luminaire list exported from DIALux.',
  },
] as const satisfies ReadonlyArray<{
  value: LuminaireInputMode;
  label: string;
  detail: string;
}>;

/** Canonical identity used only when comparing visible luminaire Tags. */
export function normalizeLuminaireTag(tag: string): string {
  return tag.trim().toLowerCase();
}

/** Canonical persisted and displayed form applied whenever a luminaire Tag is written. */
export function canonicalizeLuminaireTag(tag: string): string {
  return tag.trim().toUpperCase();
}

export function duplicateLuminaireTagMessage(tag: string): string {
  return `Type / Tag "${canonicalizeLuminaireTag(tag)}" already exists in this project.`;
}

export const pdfPaperSizes = ['Auto', 'A4', 'A3'] as const;
export type PdfPaperSize = (typeof pdfPaperSizes)[number];

export const projectOutputFolderKeys = [
  'scheduleExcel',
  'schedulePdf',
  'boqExcel',
  'boqPdf',
  'datasheets',
] as const;
export type ProjectOutputFolderKey = (typeof projectOutputFolderKeys)[number];
export type ProjectOutputFolders = Record<ProjectOutputFolderKey, string>;

export interface PersonalWorkspaceSettings {
  projectRoot: string;
  defaultFolderProfile: string;
  defaultInputMode: LuminaireInputMode;
  autoOpenProjectFolder: boolean;
  designerName: string;
  companyName: string;
  companyLogoPath: string;
  accentColor: string;
  timeZone: string;
  backupRetention: number;
  updatedAt: string;
}

export interface BackupRecord {
  fileName: string;
  filePath: string;
  sizeBytes: number;
  createdAt: string;
  reason: string;
  managedAssetCount?: number;
  managedAssetsVerified?: boolean;
}

export const workspaceItemStatuses = [
  'Open',
  'InProgress',
  'Waiting',
  'Completed',
  'Cancelled',
] as const;
export type WorkspaceItemStatus = (typeof workspaceItemStatuses)[number];

export const requirementStatuses = ['Missing', 'Requested', 'Received', 'NotRequired'] as const;
export type RequirementStatus = (typeof requirementStatuses)[number];

export const requirementImpacts = ['Low', 'Medium', 'High', 'Blocking'] as const;
export type RequirementImpact = (typeof requirementImpacts)[number];

/** Shared, presentation-neutral palette for persisted Personal catalog metadata. */
export const v4PaletteColorKeys = [
  'teal',
  'blue',
  'purple',
  'gold',
  'green',
  'red',
  'slate',
] as const;
export type V4PaletteColorKey = (typeof v4PaletteColorKeys)[number];
/** Backward-compatible Scope vocabulary. */
export const projectTagColorKeys = v4PaletteColorKeys;
export type ProjectTagColorKey = V4PaletteColorKey;
export const scopeNoteTypes = ['Note', 'Exclusion'] as const;
export type ScopeNoteType = (typeof scopeNoteTypes)[number];

/** The sole display-label normalization used to derive project tag uniqueness. */
export function normalizeProjectTagLabel(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/** Canonical display form for reusable global catalog labels. */
export function normalizeCatalogLabel(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/** Locale-independent persistence identity for reusable global catalog labels. */
export function normalizedCatalogIdentity(value: string): string {
  return normalizeCatalogLabel(value).toLowerCase();
}

export const actionCategoryIconKeys = [
  'lightbulb',
  'sun',
  'layout',
  'lamp',
  'table',
  'receipt',
  'file-text',
  'package',
  'revision',
  'message',
  'people',
  'location',
  'checklist',
  'calendar',
  'tags',
  'ruler',
  'calculator',
  'building',
  'tool',
  'settings',
  'warning',
  'clock',
  'presentation',
  'image',
  'box',
  'layers',
  'contact',
  'target',
  'search',
  'shield',
  'download',
  'upload',
] as const;
export type ActionCategoryIconKey = (typeof actionCategoryIconKeys)[number];
export type ActionCategoryColorKey = V4PaletteColorKey;

export interface ActionCategory {
  id: string;
  label: string;
  iconKey: ActionCategoryIconKey;
  colorKey: ActionCategoryColorKey;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectTag {
  id: string;
  projectId: string;
  label: string;
  colorKey: ProjectTagColorKey;
  createdAt: string;
  updatedAt: string;
}

export interface ScopeNote {
  id: string;
  projectId: string;
  type: ScopeNoteType;
  text: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export const workspaceSourceTypes = ['Manual', 'Email', 'Meeting', 'PDF', 'Drawing'] as const;
export type WorkspaceSourceType = (typeof workspaceSourceTypes)[number];

export const meetingStatuses = ['Planned', 'Held', 'Cancelled'] as const;
export type MeetingStatus = (typeof meetingStatuses)[number];

/** Locked canonical calendar/presentation timezone for Meetings. */
export const MEETING_TIME_ZONE = 'Asia/Dubai' as const;

export function meetingCalendarDay(instant: Date | string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MEETING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(typeof instant === 'string' ? new Date(instant) : instant);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export const meetingActionRelationTypes = ['Linked', 'CreatedFromMeeting'] as const;
export type MeetingActionRelationType = (typeof meetingActionRelationTypes)[number];

export const reviewItemStatuses = [
  'Open',
  'Accepted',
  'InProgress',
  'Resolved',
  'Rejected',
] as const;
export type ReviewItemStatus = (typeof reviewItemStatuses)[number];

export const revisionStatuses = [
  'Draft',
  'InProgress',
  'InternalReview',
  'ReadyToIssue',
  'Issued',
  'Superseded',
] as const;
export type RevisionStatus = (typeof revisionStatuses)[number];

export const documentCategories = [
  'Drawing',
  'LuxReport',
  'Visualization',
  'LuminaireSchedule',
  'TechnicalBoq',
  'Datasheet',
  'MeetingMinutes',
  'CommentResponse',
  'RevisionRegister',
  'IssueSummary',
  'CoverSheet',
  'Transmittal',
  'Other',
] as const;
export type DocumentCategory = (typeof documentCategories)[number];

export const documentStatuses = ['Working', 'InternalReview', 'Issued', 'Superseded'] as const;
export type DocumentStatus = (typeof documentStatuses)[number];

export const communicationKinds = ['Email', 'Calendar'] as const;
export type CommunicationKind = (typeof communicationKinds)[number];

export interface ProjectRequirement {
  id: string;
  projectId: string;
  category: string;
  title: string;
  details: string;
  requestedFrom: string;
  requestedAt: string | null;
  dueDate: string | null;
  status: RequirementStatus;
  impact: RequirementImpact;
  sourceType: WorkspaceSourceType;
  sourceReference: string;
  notes: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectChecklistItem {
  id: string;
  projectId: string;
  category: string;
  title: string;
  serviceCode: ProjectServiceCode | null;
  required: boolean;
  completed: boolean;
  waived: boolean;
  waiverReason: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectActionItem {
  id: string;
  projectId: string;
  title: string;
  details: string;
  owner: string;
  ownerRole: string;
  dueDate: string | null;
  status: WorkspaceItemStatus;
  priority: import('./types').Priority;
  sourceType: WorkspaceSourceType;
  sourceId: string | null;
  revisionId: string | null;
  categoryId: string | null;
  notes: string;
  area?: string;
  luminaireId?: string | null;
  reviewItemId?: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * P5D — explicit issue-blocking semantics. Opt-in flag; legacy rows read as
   * false. Only OPEN / IN_PROGRESS actions with blocksIssue=true block Issue.
   */
  blocksIssue?: boolean;
  /** P5D — optimistic-concurrency version. Legacy rows read as 1. */
  rowVersion?: number;
  /** P5D — actor snapshots for traceability. Null for legacy rows. */
  createdById?: string | null;
  createdByName?: string | null;
  updatedById?: string | null;
  updatedByName?: string | null;
}

export interface ProjectMeeting {
  id: string;
  projectId: string;
  title: string;
  purpose: string;
  startAt: string;
  endAt: string;
  location: string;
  attendees: string[];
  agenda: string;
  notes: string;
  decisions: string;
  onlineMeetingUrl: string;
  externalEventId: string | null;
  status: MeetingStatus;
  createdAt: string;
  updatedAt: string;
}

export interface MeetingParticipant {
  id: string;
  meetingId: string;
  name: string;
  role: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface MeetingAgendaItem {
  id: string;
  meetingId: string;
  content: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface MeetingNote {
  id: string;
  meetingId: string;
  content: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
}

export interface MeetingActionLink {
  id: string;
  projectId: string;
  meetingId: string;
  actionId: string;
  relationType: MeetingActionRelationType;
  createdAt: string;
}

/** Small, canonical projection for a Meetings collection; it intentionally omits note bodies. */
export interface MeetingListItem extends ProjectMeeting {
  participantsCount: number;
  participantPreview: MeetingParticipant[];
  notesCount: number;
  latestNoteSummary: MeetingNote | null;
  linkedActionsCount: number;
  actionsCreatedCount: number;
}

/** Inspector authority: actions are joined live rather than copied into link rows. */
export interface MeetingDetail extends ProjectMeeting {
  participants: MeetingParticipant[];
  agendaItems: MeetingAgendaItem[];
  notesCount: number;
  latestNote: MeetingNote | null;
  linkedActions: Array<{
    id: string;
    title: string;
    priority: ProjectActionItem['priority'];
    owner: string;
    dueDate: string | null;
    status: ProjectActionItem['status'];
    relationType: MeetingActionRelationType;
  }>;
  actionsCreatedCount: number;
}

export interface ProjectReviewItem {
  id: string;
  projectId: string;
  reference: string;
  title: string;
  description: string;
  area: string;
  luminaireTag: string;
  drawingReference: string;
  sourceType: WorkspaceSourceType;
  sourceId: string | null;
  status: ReviewItemStatus;
  response: string;
  revisionId: string | null;
  /** Authored-side authority. Null is valid for legacy rows. */
  origin: ReviewOrigin | null;
  /** Authored snapshot identity, not necessarily a global AppUser or Contact identity. */
  authorId: string | null;
  authorNameSnapshot: string | null;
  authorRoleSnapshot: string | null;
  /** Stable same-project Luminaire relation. The Tag remains a compatibility snapshot. */
  luminaireId: string | null;
  receivedAt: string;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export const reviewOrigins = ['Client', 'Internal'] as const;
export type ReviewOrigin = (typeof reviewOrigins)[number];

export interface ProjectReviewReply {
  id: string;
  projectId: string;
  reviewItemId: string;
  body: string;
  authorId: string;
  authorNameSnapshot: string;
  authorRoleSnapshot: string;
  origin: ReviewOrigin;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectReviewAttachment {
  id: string;
  projectId: string;
  documentId: string;
  reviewItemId: string | null;
  replyId: string | null;
  createdById: string;
  createdByNameSnapshot: string;
  createdAt: string;
}

/** Flat project-scoped read model; roots continue to arrive in ProjectWorkspace. */
export interface ProjectReviewThreadContext {
  replies: ProjectReviewReply[];
  attachments: ProjectReviewAttachment[];
}

export interface ProjectRevision {
  id: string;
  projectId: string;
  revisionNumber: number;
  title: string;
  status: RevisionStatus;
  receivedAt: string | null;
  dueDate: string | null;
  issuedAt: string | null;
  summary: string;
  changeLog: string;
  sourceType: WorkspaceSourceType;
  sourceReference: string;
  locked: boolean;
  snapshotHash: string;
  reissueNumber: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDocument {
  id: string;
  projectId: string;
  category: DocumentCategory;
  documentNumber: string;
  title: string;
  revision: string;
  status: DocumentStatus;
  filePath: string;
  issuedTo: string;
  issueDate: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectFileCenterItem {
  documentId: string;
  title: string;
  category: DocumentCategory;
  filePath: string;
  state: 'Current' | 'Outdated' | 'Missing' | 'NotGenerated';
  sizeBytes: number;
  modifiedAt: string | null;
  oneDrive: boolean;
  note: string;
}

export const projectFolderFileCategories = [
  'Drawings',
  'Dialux',
  'Renderings',
  'Schedules',
  'TechnicalBoq',
  'Datasheets',
  'MeetingMinutes',
  'Other',
] as const;
export type ProjectFolderFileCategory = (typeof projectFolderFileCategories)[number];

export const projectFolderFileAvailabilities = ['Local', 'OneDriveManaged', 'Unavailable'] as const;
export type ProjectFolderFileAvailability = (typeof projectFolderFileAvailabilities)[number];

export interface ProjectFolderFileItem {
  id: string;
  projectId: string;
  category: ProjectFolderFileCategory;
  fileName: string;
  relativePath: string;
  filePath: string;
  extension: string;
  sizeBytes: number;
  modifiedAt: string | null;
  availability: ProjectFolderFileAvailability;
  confidence: number;
  indexedAt: string;
}

export interface ProjectFolderIndex {
  projectId: string;
  folderPath: string;
  indexedAt: string | null;
  fileCount: number;
  totalBytes: number;
  oneDriveManaged: boolean;
  truncated: boolean;
  counts: Record<ProjectFolderFileCategory, number>;
  items: ProjectFolderFileItem[];
}

export interface LegacyProjectCandidate {
  folderName: string;
  folderPath: string;
  recognized: boolean;
  sequenceNumber: number | null;
  projectDate: string | null;
  projectCode: string;
  projectName: string;
  duplicateProjectId: string | null;
  warnings: string[];
}

export interface LegacyProjectPreview {
  rootPath: string;
  scannedAt: string;
  nextProjectNumber: number;
  candidates: LegacyProjectCandidate[];
}

export interface LegacyProjectImportResult {
  imported: Array<{
    projectId: string;
    projectCode: string;
    projectName: string;
    folderPath: string;
    fileCount: number;
    scanWarning: string;
  }>;
  skipped: number;
  nextProjectNumber: number;
}

export interface ProjectContact {
  group?: string | undefined;
  notes?: string | undefined;
  archived?: boolean | undefined;
  id: string;
  projectId: string;
  name: string;
  email: string;
  company: string;
  role: string;
  phone?: string;
  isPrimary?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectCommunication {
  id: string;
  projectId: string | null;
  externalId: string;
  kind: CommunicationKind;
  conversationId: string;
  subject: string;
  sender: string;
  participants: string[];
  occurredAt: string;
  endAt: string | null;
  preview: string;
  webLink: string;
  hasAttachments: boolean;
  manuallyLinked: boolean;
  syncedAt: string;
}

export interface WorkspaceActivity {
  id: string;
  projectId: string;
  entityType: string;
  entityId: string | null;
  action: string;
  title: string;
  detail: string;
  createdAt: string;
}

export interface ProjectQualityCheck {
  key: string;
  label: string;
  detail: string;
  severity: 'Info' | 'Warning' | 'Blocking';
  passed: boolean;
}

export interface ProjectHealth {
  score: number;
  checklistPercent: number;
  openRequirements: number;
  blockingRequirements: number;
  overdueActions: number;
  unresolvedReviews: number;
  checks: ProjectQualityCheck[];
}

export interface MicrosoftConnection {
  tenantId: string;
  clientId: string;
  connected: boolean;
  accountName: string;
  accountEmail: string;
  mailSyncEnabled: boolean;
  calendarSyncEnabled: boolean;
  syncIntervalMinutes: number;
  lastSyncAt: string | null;
  lastError: string | null;
  updatedAt: string;
}

export interface MicrosoftDeviceCodeSession {
  flowId: string;
  userCode: string;
  verificationUri: string;
  message: string;
  expiresAt: string;
  intervalSeconds: number;
}

export interface PersonalPortfolioOperations {
  overdueActions: ProjectActionItem[];
  upcomingActions: ProjectActionItem[];
  upcomingMeetings: ProjectMeeting[];
  blockingRequirements: ProjectRequirement[];
  openReviews: ProjectReviewItem[];
}

export interface PeriodActivityProject {
  completedDeliverableCount?: number;
  /** Full net duration of closed sessions started in the selected period. Open sessions excluded. */
  workSeconds?: number;
  workSessionCount?: number;
  openWorkSessionCount?: number;
  toolSessionCount?: number;
  projectId: string;
  projectCode: string;
  projectName: string;
  clientName: string;
  salesOwnerId: string;
  salesOwnerName: string;
  statusAtPeriodEnd: import('./types.js').ProjectStatus;
  workedOn: boolean;
  createdInPeriod: boolean;
  completedInPeriod: boolean;
  cancelledInPeriod: boolean;
  reopenedInPeriod: boolean;
  revisionCount: number;
  packageCount: number;
  activityCount: number;
  cancellationReason: string;
  lastActivityAt: string | null;
}

export interface PeriodActivityReport {
  /** Current snapshots are explicitly separate from events in the selected period. */
  currentProjects?: Array<{
    designerName?: string;
    stage?: string;
    dueDate?: string;
    revisions?: number;
    generatedOutputs?: number;
    issuedPackages?: number;
    readiness?: {
      revisionId: string;
      revisionLabel: string;
      level: string;
      blockers: number;
      warnings: number;
    } | null;
    failedQualityChecks?: number;
    projectId: string;
    projectCode: string;
    projectName: string;
    clientName: string;
    salesOwnerName: string;
    status: string;
    luminaires: number;
    missingDatasheets: number;
    missingImages: number;
    incompleteTechnical: number;
    openRequirements: number;
    openActions: number;
    overdueActions: number;
    unresolvedReviews: number;
    upcomingMeetings: number;
    deliverables: number;
    completedDeliverables: number;
  }>;
  sessions?: Array<{
    actorId?: string;
    actorName?: string;
    id: string;
    projectId: string;
    projectName: string;
    startedAt: string;
    endedAt: string | null;
    day: string;
    state: 'RUNNING' | 'PAUSED' | 'STOPPED';
    netSeconds: number | null;
    pausedSeconds: number;
  }>;
  from: string;
  to: string;
  generatedAt: string;
  projectsWorkedOn: number;
  newProjects: number;
  completedProjects: number;
  activeAtEnd: number;
  waitingAtEnd: number;
  onHoldAtEnd: number;
  cancelledProjects: number;
  reopenedProjects: number;
  revisionsCreated: number;
  packagesCreated: number;
  deliverablesCompleted: number;
  bySales: Array<{ label: string; value: number }>;
  byStatus: Array<{ label: string; value: number }>;
  projects: PeriodActivityProject[];
}

export interface WorkspaceSearchResult {
  id: string;
  projectId: string;
  type: 'Project' | 'Action' | 'Review' | 'Meeting' | 'Document' | 'Luminaire';
  title: string;
  detail: string;
  date: string;
}

export interface FolderNodePreset {
  name: string;
  children: FolderNodePreset[];
}

export type FolderProfilePresetSource = 'factory' | 'user' | 'legacy';

export interface FolderProfilePreset {
  name: string;
  description: string;
  folders: FolderNodePreset[];
  outputFolders: ProjectOutputFolders;
  /**
   * Additive server-owned output defaults that are not part of the legacy
   * five-key ProjectOutputFolders view. Factory profiles use this contract for
   * P4B capture destinations; unknown/custom keys remain valid and are never
   * coerced into the legacy record.
   */
  additionalOutputDefaults?: Readonly<Record<string, string>>;
  builtIn: boolean;
  /** P2.4B3B1A: stable machine key for built-in factory profiles (source = 'factory'). */
  factoryProfileKey?: string;
  /** P2.4B3B1A: additive canonical source classification for the Settings UI. */
  source?: FolderProfilePresetSource;
  /** P2.4B3B1A: canonical profile UUID when source = 'user'. */
  profileId?: string;
}

export interface ProjectDeliverable {
  id: string;
  projectId: string;
  serviceCode: ProjectServiceCode;
  title: string;
  status: DeliverableStatus;
  progressPercent: number;
  required: boolean;
  dueDate: string | null;
  sortOrder: number;
  updatedAt: string;
}

export interface LuminaireRecord {
  id: string;
  projectId: string;
  tag: string;
  category: string;
  imagePath: string;
  description: string;
  manufacturer: string;
  model: string;
  productType?: string | undefined;
  variantLabel?: string | undefined;
  orderingCode?: string | undefined;
  wattage: string;
  lumens: string;
  lightColor: string;
  cri: string;
  beamAngle: string;
  ipRating: string;
  mounting: string;
  cutout: string;
  driver: string;
  control: string;
  emergency: string;
  datasheetPath: string;
  location: string;
  unit: string;
  quantity: number;
  notes: string;
  sourceName: string;
  dimensions: string;
  bodyColorFinish: string;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}

/** Types admitted by the legacy/manual Project attachment picker. */
export const luminaireAssetTypes = ['Datasheet', 'ProductImage'] as const;
/** Project storage can additionally contain exact Library-derived photometry snapshots. */
export type LuminaireAssetType = (typeof luminaireAssetTypes)[number] | 'IES' | 'LDT';

/** Immutable project- and Luminaire-scoped snapshot of an attached asset. */
export interface LuminaireAssetVersion {
  id: string;
  projectId: string;
  luminaireId: string;
  assetType: LuminaireAssetType;
  versionSequence: number;
  filePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number | null;
  fileHash: string | null;
  backfilled: boolean;
  attachedAt: string;
  attachedById: string | null;
  attachedByNameSnapshot: string | null;
  locatorKind?: 'LEGACY_PATH' | 'DATA_ROOT_RELATIVE';
  locatorValue?: string;
  sourceLibraryAssetVersionId?: string | null;
}

export interface LuminaireAssetSummary {
  luminaireId: string;
  datasheet: LuminaireAssetVersion | null;
  productImage: LuminaireAssetVersion | null;
  ies?: LuminaireAssetVersion | null;
  ldt?: LuminaireAssetVersion | null;
}

export const localIntelligenceFieldKeys = [
  'manufacturer',
  'model',
  'orderingCode',
  'variantLabel',
  'wattage',
  'lumens',
  'lightColor',
  'cri',
  'beamAngle',
  'ipRating',
  'mounting',
  'cutout',
  'driver',
  'control',
  'emergency',
  'dimensions',
  'bodyColorFinish',
] as const;
export type LocalIntelligenceFieldKey = (typeof localIntelligenceFieldKeys)[number];

export type DatasheetComparisonStatus =
  'Matched' | 'Mismatch' | 'MissingSchedule' | 'MissingDatasheet' | 'NeedsReview';

export type DatasheetVerificationResult =
  | 'MATCH'
  | 'CONFLICT'
  | 'MISSING_IN_TABLE'
  | 'MISSING_IN_DATASHEET'
  | 'UNVERIFIED'
  | 'POSSIBLE_WRONG_DATASHEET';

export interface DatasheetFieldExtraction {
  fieldKey: LocalIntelligenceFieldKey;
  label: string;
  value: string;
  alternatives: string[];
  confidence: number;
  pageNumber: number;
  evidence: string;
  ambiguous: boolean;
  verificationResult?: DatasheetVerificationResult;
  method?: 'NATIVE_TEXT' | 'NATIVE_TABLE' | 'OCR';
  confidenceBand?: 'HIGH' | 'MEDIUM' | 'LOW';
  unit?: string | null;
  basis?: string | null;
  region?: Readonly<{ x: number; y: number; width: number; height: number }> | null;
  canUseDatasheetValue?: boolean;
  reviewNotes?: string[];
}

export interface DatasheetComparisonField extends DatasheetFieldExtraction {
  scheduleValue: string;
  status: DatasheetComparisonStatus;
}

export interface LuminaireDatasheetAnalysis {
  luminaireId: string;
  tag: string;
  datasheetPath: string;
  fileName: string;
  analyzedAt: string;
  engine: 'SCLI Local Intelligence 1.0' | 'SCLI P5C Datasheet Verification 1.0';
  privacyMode: 'LocalOnly';
  status: 'Ready' | 'NeedsReview' | 'Unavailable' | 'Unsupported';
  message: string;
  pageCount: number;
  textAvailable: boolean;
  comparisons: DatasheetComparisonField[];
  counts: Record<DatasheetComparisonStatus, number>;
  verificationId?: string;
  verificationFingerprint?: string;
  verificationState?: 'CURRENT' | 'STALE' | 'SUPERSEDED';
  datasheetAssetVersionId?: string;
  documentId?: string;
  documentVersionId?: string;
  identityResult?: 'MATCH' | 'UNVERIFIED' | 'POSSIBLE_WRONG_DATASHEET';
  authorityKind?: 'PROJECT_ROW' | 'LIBRARY_VERSION';
  reusedExtraction?: boolean;
  libraryLinked?: boolean;
}

export type LegacyDatasheetAdoptionReason =
  | 'READY_TO_ADOPT'
  | 'ALREADY_MANAGED'
  | 'STORAGE_UNVERIFIED'
  | 'LEGACY_DATASHEET_REQUIRES_ADOPTION'
  | 'SOURCE_FILE_MISSING'
  | 'SOURCE_HASH_MISMATCH'
  | 'PDF_VALIDATION_FAILED'
  | 'WRONG_ASSET_TYPE'
  | 'CURRENT_ATTACHMENT_CHANGED'
  | 'BACKUP_FAILED'
  | 'ADOPTION_FAILED';

export type LegacyDatasheetAdoptionStatus =
  | 'ADOPTED'
  | 'READY_TO_ADOPT'
  | 'ALREADY_MANAGED'
  | 'BLOCKED_STORAGE_UNVERIFIED'
  | 'BLOCKED_FILE_MISSING'
  | 'BLOCKED_HASH_MISMATCH'
  | 'BLOCKED_WRONG_ASSET_TYPE'
  | 'BLOCKED_PDF_VALIDATION'
  | 'FAILED';

export interface LegacyDatasheetAdoptionItemResult {
  luminaireId: string;
  tag: string;
  requestedAssetVersionId: string;
  resultingAssetVersionId: string | null;
  status: LegacyDatasheetAdoptionStatus;
  reasonCode: LegacyDatasheetAdoptionReason;
  message: string;
}

export interface LegacyDatasheetAdoptionBatchResult {
  projectId: string;
  backupId: string | null;
  items: LegacyDatasheetAdoptionItemResult[];
}

export type LuminaireDatasheetBatchOutcomeStatus =
  'VERIFIED' | 'NEEDS_ADOPTION' | 'PROCESSING_FAILED' | 'MISSING_DATASHEET' | 'UNVERIFIED';

export type LuminaireDatasheetFailureReason =
  | 'NONE'
  | 'LEGACY_DATASHEET_REQUIRES_ADOPTION'
  | 'STORAGE_UNVERIFIED'
  | 'SOURCE_FILE_MISSING'
  | 'SOURCE_HASH_MISMATCH'
  | 'PDF_VALIDATION_FAILED'
  | 'NATIVE_EXTRACTION_FAILED'
  | 'OCR_FAILED'
  | 'SEMANTIC_EXTRACTION_FAILED'
  | 'VERIFICATION_FAILED'
  | 'MISSING_DATASHEET';

export interface LuminaireDatasheetBatchOutcome {
  luminaireId: string;
  tag: string;
  status: LuminaireDatasheetBatchOutcomeStatus;
  reasonCode: LuminaireDatasheetFailureReason;
  message: string;
  analysis: LuminaireDatasheetAnalysis | null;
}

export interface LuminaireDatasheetBatchResult {
  projectId: string;
  items: LuminaireDatasheetBatchOutcome[];
  summary: {
    total: number;
    analyzed: number;
    verified: number;
    needsAdoption: number;
    failed: number;
    unverified: number;
  };
}

export interface LocalFileClassification {
  itemId: string;
  fileName: string;
  relativePath: string;
  currentCategory: ProjectFolderFileCategory;
  suggestedCategory: ProjectFolderFileCategory;
  confidence: number;
  source: 'Path' | 'PdfText';
  reason: string;
  changed: boolean;
}

export interface LocalProjectBrief {
  headline: string;
  summary: string;
  nextActions: string[];
  warnings: string[];
}

export interface LocalIntelligenceOverview {
  projectId: string;
  generatedAt: string;
  engine: 'SCLI Local Intelligence 1.0';
  privacyMode: 'LocalOnly';
  readinessScore: number;
  checks: ProjectQualityCheck[];
  brief: LocalProjectBrief;
  fileClassifications: LocalFileClassification[];
  stats: {
    luminaireCount: number;
    linkedDatasheets: number;
    missingDatasheets: number;
    indexedFiles: number;
    classificationsNeedingReview: number;
  };
}

export interface OutputColumn {
  fieldKey: string;
  header: string;
  visible: boolean;
  sortOrder: number;
  width: number;
  compareInRevision: boolean;
  requiredForIssue: boolean;
  internalOnly: boolean;
}

export const revisionPackageGroups = [
  'SchedulePdf',
  'ScheduleExcel',
  'TechnicalBoqPdf',
  'TechnicalBoqExcel',
  'LayoutDrawings',
  'DialuxReports',
  'Renderings',
  'Datasheets',
  'MeetingMinutes',
  'CommentResponse',
  'RevisionRegister',
  'IssueSummary',
  'CoverSheet',
  /**
   * B2 — generic immutable Document Snapshot deliverables land here. The
   * legacy document/folder-index groups above remain, but canonical packages
   * never produce them; snapshot members map to a neutral Documents group so
   * package grouping derives from real deliverable source metadata.
   */
  'Documents',
] as const;
export type RevisionPackageGroup = (typeof revisionPackageGroups)[number];

export const revisionPackageOutputModes = ['Folder', 'Zip', 'Both'] as const;
export type RevisionPackageOutputMode = (typeof revisionPackageOutputModes)[number];
export const revisionPackageStatuses = ['Draft', 'Issued'] as const;
export type RevisionPackageStatus = (typeof revisionPackageStatuses)[number];

export interface RevisionPackageItem {
  id: string;
  group: RevisionPackageGroup;
  label: string;
  fileName: string;
  filePath: string;
  available: boolean;
  outdated: boolean;
  sizeBytes: number;
  modifiedAt: string | null;
  note: string;
  /**
   * PACKAGES-E2E-05B — structured Luminaire metadata for a Datasheet
   * DocumentSnapshot package row. Present ONLY when the item is a Datasheet
   * snapshot; derived structurally from sourceAssetVersionId -> Luminaire
   * (never from title/fileName/path). Absent for every other deliverable.
   */
  datasheet?: { tag: string; manufacturer: string; model: string };
}

export interface RevisionPackageCatalog {
  items: RevisionPackageItem[];
  checks: ProjectQualityCheck[];
  /**
   * Canonical identity of the server-selected Revision (UUID). The catalog is
   * authoritative for exactly ONE Revision; consumers must bind ownership on
   * this id. Null when no eligible canonical Revision exists — never inferred
   * from the display sequence, and never a fabricated fallback.
   */
  revisionId: string | null;
  /**
   * Per-project display sequence of the server-selected Revision. Presentation
   * and folder-name derivation only; must never select the canonical Revision.
   */
  suggestedRevision: number;
  suggestedOutputFolder: string;
}

export interface RevisionPackageManifestItem {
  itemId: string;
  group: RevisionPackageGroup;
  label: string;
  fileName: string;
  sourcePath: string;
  sizeBytes: number;
  sha256: string;
  /**
   * B2 — generic immutable deliverable source identity (canonical packages
   * only). Absent on legacy/non-canonical rows. sourceType is either
   * 'GeneratedOutput' (sourceId = outputId) or 'DocumentSnapshot'
   * (sourceId = immutable snapshot deliverableId — never the mutable
   * ProjectDocument).
   */
  sourceType?: 'GeneratedOutput' | 'DocumentSnapshot';
  sourceId?: string;
}

export interface RevisionLuminaireSnapshot {
  /** Present on canonical snapshots; absent only for preserved pre-v4 package history. */
  luminaireId?: string;
  tag: string;
  values: Record<string, string | number>;
}

export interface RevisionComparisonItem {
  tag: string;
  status: 'Added' | 'Removed' | 'Changed';
  changes: Array<{ fieldKey: string; before: string | number; after: string | number }>;
}

export interface RevisionPackageComparison {
  fromPackageId: string;
  toPackageId: string;
  added: number;
  removed: number;
  changed: number;
  items: RevisionComparisonItem[];
}

export interface RevisionPackageRecord {
  id: string;
  projectId: string;
  revisionNumber: number;
  reissueNumber: number;
  label: string;
  status: RevisionPackageStatus;
  outputMode: RevisionPackageOutputMode;
  folderPath: string;
  zipPath: string;
  itemCount: number;
  totalBytes: number;
  packageHash: string;
  warningOverrideReason: string;
  manifest: RevisionPackageManifestItem[];
  luminaireSnapshot: RevisionLuminaireSnapshot[];
  /**
   * Immutable Issue audit authority (V4-ISSUE-A0). Null for Draft packages and for
   * pre-migration/legacy rows whose Issue event is unknown. Never inferred from
   * createdAt/finalizedAt and never rewritten by recovery.
   */
  issuedById: string | null;
  issuedByName: string | null;
  issuedAt: string | null;
  createdAt: string;
}

export interface ProjectLightingPackage {
  projectId: string;
  inputMode: LuminaireInputMode;
  pdfPaperSize: PdfPaperSize;
  scheduleColumns: OutputColumn[];
  boqColumns: OutputColumn[];
  updatedAt: string;
}

export interface ProjectExportRecord {
  id: string;
  projectId: string;
  revision: number;
  excelPath: string;
  pdfPath: string;
  datasheetFolder: string;
  scheduleExcelPath: string;
  schedulePdfPath: string;
  boqExcelPath: string;
  boqPdfPath: string;
  createdAt: string;
}

export interface ProjectWorkspace {
  projectId: string;
  folderPath: string | null;
  folderProfile: string;
  folderStructure: FolderNodePreset[];
  outputFolders: ProjectOutputFolders;
  services: ProjectServiceCode[];
  deliverables: ProjectDeliverable[];
  lightingPackage: ProjectLightingPackage;
  luminaires: LuminaireRecord[];
  exports: ProjectExportRecord[];
  revisionPackages: RevisionPackageRecord[];
  requirements: ProjectRequirement[];
  tags: ProjectTag[];
  scopeNotes: ScopeNote[];
  checklist: ProjectChecklistItem[];
  actions: ProjectActionItem[];
  meetings: ProjectMeeting[];
  reviewItems: ProjectReviewItem[];
  revisions: ProjectRevision[];
  documents: ProjectDocument[];
  fileCenter: ProjectFileCenterItem[];
  contacts: ProjectContact[];
  communications: ProjectCommunication[];
  activity: WorkspaceActivity[];
  health: ProjectHealth;
  updatedAt: string;
}

export const projectServiceLabels: Record<ProjectServiceCode, string> = {
  LightingLayout: 'Lighting Layout',
  LightingDesign: 'Lighting Design',
  DialuxCalculation: 'DIALux Calculation',
  DialuxReport: 'DIALux Report',
  Visualization3D: '3D Visualization',
  Presentation: 'Presentation',
  LuminaireSchedule: 'Luminaire Schedule',
  TechnicalBoq: 'Technical BOQ',
  Datasheets: 'Datasheets Package',
  Custom: 'Custom Deliverable',
};

export const deliverableStatusLabels: Record<DeliverableStatus, string> = {
  NotStarted: 'Not Started',
  InProgress: 'In Progress',
  Waiting: 'Waiting',
  Review: 'Review',
  Completed: 'Completed',
  NotRequired: 'Not Required',
};
