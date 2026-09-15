import { DomainError } from './errors';
import type { FolderNodePreset, FolderProfilePreset, ProjectOutputFolders } from './personal';

export const roles = ['Sales', 'Designer', 'LineManager', 'Admin'] as const;
export type Role = (typeof roles)[number];

export const availabilityStatuses = ['Available', 'Limited', 'FullyLoaded', 'Unavailable'] as const;
export type AvailabilityStatus = (typeof availabilityStatuses)[number];

export const projectStatuses = [
  'Planning',
  'NewRequest',
  'UnderReview',
  'Unassigned',
  'Assigned',
  'InProgress',
  'ClientReview',
  'WaitingForInformation',
  'WaitingForSales',
  'InternalReview',
  'RevisionRequired',
  'ReadyToIssue',
  'Issued',
  'OnHold',
  'Completed',
  'Archived',
  'Cancelled',
] as const;
export type ProjectStatus = (typeof projectStatuses)[number];

export const priorities = ['Low', 'Normal', 'High', 'Urgent'] as const;
export type Priority = (typeof priorities)[number];

export const complexities = ['Small', 'Medium', 'Large'] as const;
export type Complexity = (typeof complexities)[number];

export const workCategories = [
  'LightingDesign',
  'DIALux',
  'Drawings',
  'Revisions',
  'Meetings',
  'SiteVisit',
  'BOQ',
  'Coordination',
] as const;
export type WorkCategory = (typeof workCategories)[number];

export const timeEntryStatuses = ['Running', 'Paused', 'Stopped'] as const;
export type TimeEntryStatus = (typeof timeEntryStatuses)[number];

export const timesheetStatuses = ['Draft', 'Submitted', 'Approved', 'Rejected'] as const;
export type TimesheetStatus = (typeof timesheetStatuses)[number];

export const designStages = [
  'Concept',
  'SchematicDesign',
  'DetailedDesign',
  'Tender',
  'Construction',
  'AsBuilt',
] as const;
export type DesignStage = (typeof designStages)[number];

export interface AppUser {
  id: string;
  entraObjectId: string;
  displayName: string;
  email: string;
  jobTitle: string;
  department: string;
  role: Role;
  weeklyCapacityHours: number;
  availabilityStatus: AvailabilityStatus;
  avatarUrl: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  /** Project-wide coordination responsibilities, independent of any selected contact. */
  responsibilityNotes?: string;
  finalSetup?: import('./final-project-setup').FinalProjectSetup;
  id: string;
  projectCode: string;
  projectName: string;
  clientName: string;
  crmReference?: string | null;
  commercialValueMinor?: number | null;
  commercialCurrency?: string | null;
  projectType: string;
  description: string;
  salesOwnerId: string;
  salesOwnerNameSnapshot: string;
  salesOwnerEmailSnapshot: string;
  createdById: string;
  createdByNameSnapshot: string;
  createdByEmailSnapshot: string;
  assignedDesignerId: string | null;
  assignedDesignerNameSnapshot: string | null;
  collaboratorDesignerIds: string[];
  collaboratorDesignerNameSnapshots: string[];
  siteLocation: string;
  designStage: DesignStage;
  lightingScope: string;
  luxRequirements: string;
  drawingReference: string;
  status: ProjectStatus;
  priority: Priority;
  complexity: Complexity;
  estimatedHours: number;
  actualHours: number;
  progressPercent: number;
  requiredDeliveryDate: string;
  projectFolderUrl: string | null;
  projectFolderPath?: string | null;
  folderProfile?: string | null;
  services?: ProjectServiceCode[];
  luminaireInputMode?: LuminaireInputMode;
  revisionNumber: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  version: number;
  isLegacyProject?: boolean;
  legacyImportedAt?: string | null;
  legacyFolderName?: string | null;
  statusBeforeArchive?: ProjectStatus | null;
  statusBeforeHold?: ProjectStatus | null;
  folderIndexedAt?: string | null;
  folderFileCount?: number;
}

export type ActivityActionType =
  | 'ProjectCreated'
  | 'CreatedOnBehalf'
  | 'SalesOwnerChanged'
  | 'DesignerAssigned'
  | 'DesignerReassigned'
  | 'ProjectTeamChanged'
  | 'StatusChanged'
  | 'ProgressChanged'
  | 'PriorityChanged'
  | 'DeadlineChanged'
  | 'HoursChanged'
  | 'RevisionRequested'
  | 'FolderLinkChanged'
  | 'CommentAdded'
  | 'ProjectUpdated'
  | 'ProjectReopened'
  | 'ProjectCancelled'
  | 'ProjectCompleted'
  | 'TimeStarted'
  | 'TimePaused'
  | 'TimeResumed'
  | 'TimeStopped'
  | 'TimeEntryCorrected'
  | 'TimesheetSubmitted'
  | 'TimesheetApproved'
  | 'TimesheetRejected'
  | 'LegacyImported'
  | 'ProjectArchived'
  | 'ProjectRestored'
  | 'ProjectReferenceChanged';

export interface ProjectActivity {
  id: string;
  projectId: string;
  actionType: ActivityActionType;
  fieldName: string | null;
  oldValue: string | null;
  newValue: string | null;
  message: string;
  changedById: string;
  changedByNameSnapshot: string;
  createdAt: string;
}

export interface ProjectComment {
  id: string;
  projectId: string;
  body: string;
  authorId: string;
  authorNameSnapshot: string;
  attachmentUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export type NotificationType =
  | 'ProjectCreated'
  | 'Assignment'
  | 'ProjectUpdated'
  | 'Comment'
  | 'Revision'
  | 'Deadline'
  | 'TimesheetSubmitted'
  | 'TimesheetApproved'
  | 'TimesheetRejected';

export interface AppNotification {
  id: string;
  recipientUserId: string;
  type: NotificationType;
  title: string;
  message: string;
  projectId: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface ProjectType {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TimeEntry {
  id: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  userId: string;
  userNameSnapshot: string;
  workCategory: WorkCategory;
  note: string;
  status: TimeEntryStatus;
  startedAt: string;
  pausedAt: string | null;
  stoppedAt: string | null;
  durationMinutes: number;
  updatedAt: string;
}

export interface ProjectTimesheet {
  projectId: string;
  projectCode: string;
  projectName: string;
  userId: string;
  userNameSnapshot: string;
  status: TimesheetStatus;
  entries: TimeEntry[];
  totalMinutes: number;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewedByNameSnapshot: string | null;
  reviewReason: string | null;
}

export interface TimeTrackingOverview {
  activeTimer: TimeEntry | null;
  todayMinutes: number;
  weekMinutes: number;
  draftTimesheets: number;
  pendingApprovals: number;
  timesheets: ProjectTimesheet[];
}

export const workCategoryLabels: Record<WorkCategory, string> = {
  LightingDesign: 'Lighting Design',
  DIALux: 'DIALux',
  Drawings: 'Drawings',
  Revisions: 'Revisions',
  Meetings: 'Meetings',
  SiteVisit: 'Site Visit',
  BOQ: 'BOQ',
  Coordination: 'Coordination',
};

export interface AppSettings {
  companyTimezone: string;
  teamsNotificationsEnabled: boolean;
  projectTypes: ProjectType[];
  updatedAt: string;
  updatedById: string | null;
}

export interface ProjectQuery {
  search?: string;
  statuses?: ProjectStatus[];
  designerId?: string;
  salesOwnerId?: string;
  priorities?: Priority[];
  projectType?: string;
  clientName?: string;
  dueFrom?: string;
  dueTo?: string;
  sortBy?: 'priority' | 'requiredDate' | 'createdDate' | 'salesOwner';
  sortDirection?: 'asc' | 'desc';
}

export interface WorkloadMetrics {
  designer: AppUser;
  activeProjectCount: number;
  activeEstimatedHours: number;
  activeActualHours: number;
  weeklyCapacityHours: number;
  remainingCapacity: number;
  utilizationPercent: number;
  availabilityPercent: number;
  overdueProjectCount: number;
  nextDeadline: string | null;
  classification: AvailabilityStatus;
  activeProjects: Project[];
}

export interface ReportSeriesItem {
  label: string;
  value: number;
}

export interface ReportSummary {
  generatedAt: string;
  totalProjects: number;
  activeProjects: number;
  overdueProjects: number;
  averageCompletionDays: number;
  totalEstimatedHours: number;
  totalActualHours: number;
  projectsByDesigner: ReportSeriesItem[];
  projectsBySalesOwner: ReportSeriesItem[];
  projectsByStatus: ReportSeriesItem[];
  completedByMonth: ReportSeriesItem[];
  revisionCounts: ReportSeriesItem[];
}

export interface IntegrationStatus {
  mode: 'mock' | 'standalone' | 'm365';
  workspaceVariant: 'personal' | 'team';
  personalAutoLogin: boolean;
  configured: boolean;
  teamsSsoConfigured: boolean;
  sharePointConfigured: boolean;
  proactiveNotificationsConfigured: boolean;
  missing: string[];
}
import { projectServiceCodes, projectServiceLabels } from './personal';
import type { LuminaireInputMode, ProjectServiceCode } from './personal';

/**
 * One entry in a project's active scope. Built-in services keep their stable
 * ProjectServiceCode identity; project-specific custom items use a stable slug
 * identity derived from their normalized label. Labels are presentation only.
 */
export interface ProjectScopeItem {
  id: string;
  code: ProjectServiceCode | null;
  label: string;
  custom: boolean;
}

export interface ProjectScopeItemInput {
  code?: ProjectServiceCode | null | undefined;
  label?: string | undefined;
  custom?: boolean | undefined;
}

/** Normalizes a scope label for duplicate detection and stable identity. */
export function normalizeScopeLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Stable identity for a project-specific custom scope item. */
export function customScopeId(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `custom:${slug || 'item'}`;
}

/** Builds the canonical built-in scope item for a service code. */
export function builtInScopeItem(code: ProjectServiceCode): ProjectScopeItem {
  return { id: code, code, label: projectServiceLabels[code], custom: false };
}

/** Converts a legacy built-in services array into scope items. */
export function scopeItemsFromServices(
  services: readonly ProjectServiceCode[],
): ProjectScopeItem[] {
  return services.map(builtInScopeItem);
}

/**
 * Parses persisted services_json into scope items. Accepts both the legacy
 * array-of-strings shape and the current array-of-objects shape. Unknown
 * strings are preserved as custom items so historical data survives round
 * trips.
 */
export function parseScopeItems(raw: unknown): ProjectScopeItem[] {
  if (!Array.isArray(raw)) return [];
  const items: ProjectScopeItem[] = [];
  for (const entry of raw) {
    if (typeof entry === 'string') {
      const trimmed = entry.trim();
      if (!trimmed) continue;
      if ((projectServiceCodes as readonly string[]).includes(trimmed)) {
        items.push(builtInScopeItem(trimmed as ProjectServiceCode));
      } else {
        items.push({ id: customScopeId(trimmed), code: null, label: trimmed, custom: true });
      }
      continue;
    }
    if (entry && typeof entry === 'object') {
      const record = entry as Record<string, unknown>;
      const custom = record.custom === true;
      const code = typeof record.code === 'string' ? (record.code as ProjectServiceCode) : null;
      const label =
        typeof record.label === 'string' && record.label.trim() ? record.label.trim() : '';
      if (custom) {
        if (!label) continue;
        const id = typeof record.id === 'string' && record.id ? record.id : customScopeId(label);
        items.push({ id, code: null, label, custom: true });
      } else if (code && (projectServiceCodes as readonly string[]).includes(code)) {
        items.push(builtInScopeItem(code));
      } else if (label) {
        // Unknown object entries are preserved as custom items.
        const id = typeof record.id === 'string' && record.id ? record.id : customScopeId(label);
        items.push({ id, code: null, label, custom: true });
      }
    }
  }
  return items;
}

/** Serializes scope items into the persisted JSON value. */
export function serializeScopeItems(items: readonly ProjectScopeItem[]): unknown {
  return items.map((item) =>
    item.custom
      ? { id: item.id, label: item.label, custom: true }
      : { code: item.code, label: item.label, custom: false },
  );
}

/** Removes duplicate custom items using normalized labels and duplicate built-ins. */
export function dedupeScopeItems(items: readonly ProjectScopeItem[]): ProjectScopeItem[] {
  const seenCustom = new Set<string>();
  const seenBuiltIn = new Set<string>();
  const result: ProjectScopeItem[] = [];
  for (const item of items) {
    if (item.custom) {
      const key = normalizeScopeLabel(item.label);
      if (seenCustom.has(key)) continue;
      seenCustom.add(key);
      result.push({ ...item, id: item.id || customScopeId(item.label) });
    } else if (item.code) {
      if (seenBuiltIn.has(item.code)) continue;
      seenBuiltIn.add(item.code);
      result.push(builtInScopeItem(item.code));
    }
  }
  return result;
}

/** Extracts the built-in service codes from a full scope. */
export function builtInCodesFromScopeItems(
  items: readonly ProjectScopeItem[],
): ProjectServiceCode[] {
  return items
    .filter((item) => !item.custom && item.code)
    .map((item) => item.code as ProjectServiceCode);
}

/**
 * Normalizes client-supplied scope input into canonical scope items. Built-in
 * entries use the canonical product label; custom entries get a stable slug id.
 */
export function normalizeScopeItemInputs(
  inputs: readonly ProjectScopeItemInput[],
): ProjectScopeItem[] {
  const items: ProjectScopeItem[] = [];
  for (const input of inputs) {
    if (input.custom) {
      const label = (input.label ?? '').trim();
      if (!label) continue;
      items.push({ id: customScopeId(label), code: null, label, custom: true });
    } else if (input.code) {
      items.push(builtInScopeItem(input.code));
    }
  }
  return dedupeScopeItems(items);
}

/**
 * Replaces the built-in portion of a scope while preserving every existing
 * custom item. Used when legacy service-only updates must not drop custom
 * project scope entries.
 */
export function replaceBuiltInScopeItems(
  current: readonly ProjectScopeItem[],
  services: readonly ProjectServiceCode[],
): ProjectScopeItem[] {
  const customs = current.filter((item) => item.custom);
  return dedupeScopeItems([...scopeItemsFromServices(services), ...customs]);
}

// ===========================================================================
// P2.4B1 â€” Canonical project folder snapshot and output mapping model
// ===========================================================================

export const folderSnapshotSchemaVersions = ['1.0'] as const;
export type FolderSnapshotSchemaVersion = (typeof folderSnapshotSchemaVersions)[number];

/** Stable identity for a folder node inside a project snapshot. */
export interface FolderNode {
  folderId: string;
  parentFolderId: string | null;
  name: string;
  displayOrder: number;
  enabled: boolean;
  semanticRole: string | null;
  /** Provenance only: the profile folder node this project folder was instantiated from. */
  sourceProfileFolderId?: string | null | undefined;
}

/** Source profile metadata captured when a project snapshot is created. */
export interface FolderProfileSource {
  profileId: string | null;
  profileName: string;
  profileRevision: string | null;
  structuralFingerprint: string;
  /** P2.4B3B1A: stable factory machine key when the source is a built-in factory profile. */
  factoryProfileKey?: string | null | undefined;
}

/** Versioned, independent project folder snapshot. */
export interface ProjectFolderSnapshot {
  schemaVersion: FolderSnapshotSchemaVersion;
  sourceProfile: FolderProfileSource | null;
  folders: FolderNode[];
}

/** Known application output semantics preserved from the legacy output keys. */
export const knownOutputTypeIds = [
  'scheduleExcel',
  'schedulePdf',
  'boqExcel',
  'boqPdf',
  'datasheets',
] as const;
export type KnownOutputTypeId = (typeof knownOutputTypeIds)[number];

/** Output type to destination folder mapping. Unresolved mappings stay explicit. */
export interface OutputMapping {
  outputTypeId: string;
  destinationFolderId: string | null;
  unresolved: boolean;
  legacyPath: string | null;
}

/** Versioned canonical output mapping set. */
export interface ProjectOutputMappings {
  schemaVersion: FolderSnapshotSchemaVersion;
  mappings: OutputMapping[];
}

/** Two independent FNV-1a passes combined into a deterministic 64-bit hex digest. */
function fnv1a64(input: string): string {
  const passes: Array<[number, number]> = [
    [0x811c9dc5, 0x01000193],
    [0x84222325, 0x01000193],
  ];
  return passes
    .map(([offset, prime]) => {
      let hash = offset >>> 0;
      for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, prime) >>> 0;
      }
      return hash.toString(16).padStart(8, '0');
    })
    .join('');
}

/** Normalizes a legacy path to a safe relative path, or '' when unsafe. */
function normalizeLegacyFolderPath(value: string): string {
  const normalized = value.trim().replaceAll('\\', '/');
  const segments = normalized
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (
    /^[a-zA-Z]:\//.test(normalized) ||
    normalized.startsWith('/') ||
    segments.some((segment) => segment === '.' || segment === '..')
  ) {
    return '';
  }
  return segments.join('/');
}

/** Deterministic legacy folder identity based on project identity + relative path. */
export function legacyFolderId(projectId: string, relativePath: string): string {
  return `legacy:${fnv1a64(`${projectId}|${relativePath}`)}`;
}

/** Deterministic structural fingerprint for a folder profile (not JSON key order). */
export function folderProfileStructuralFingerprint(
  folders: readonly FolderNodePreset[],
  outputFolders: ProjectOutputFolders,
): string {
  const lines: string[] = [];
  const visit = (nodes: readonly FolderNodePreset[], depth: number): void => {
    for (const node of nodes) {
      lines.push(`${depth}:${node.name.trim()}`);
      visit(node.children, depth + 1);
    }
  };
  visit(folders, 0);
  for (const key of [...knownOutputTypeIds].sort()) {
    lines.push(`output:${key}=${outputFolders[key] ?? ''}`);
  }
  return fnv1a64(lines.join('\n'));
}

/** Builds a canonical snapshot from a preset tree, assigning stable IDs once. */
export function buildProjectFolderSnapshot(
  folders: readonly FolderNodePreset[],
  sourceProfile: FolderProfileSource | null,
  generateId: () => string,
): ProjectFolderSnapshot {
  const nodes: FolderNode[] = [];
  const visit = (list: readonly FolderNodePreset[], parentFolderId: string | null): void => {
    list.forEach((preset, index) => {
      const folderId = generateId();
      nodes.push({
        folderId,
        parentFolderId,
        name: preset.name.trim(),
        displayOrder: index,
        enabled: true,
        semanticRole: null,
      });
      visit(preset.children, folderId);
    });
  };
  visit(folders, null);
  return { schemaVersion: '1.0', sourceProfile, folders: nodes };
}

/** Rebuilds a snapshot from a preset tree, reusing existing IDs by relative path. */
export function rebuildFolderSnapshot(
  current: ProjectFolderSnapshot | null,
  folders: readonly FolderNodePreset[],
  generateId: () => string,
): ProjectFolderSnapshot {
  const currentByPath = new Map<string, FolderNode>();
  if (current) {
    for (const node of current.folders) {
      const relativePath = deriveFolderRelativePath(current, node.folderId);
      if (relativePath) currentByPath.set(relativePath.toLowerCase(), node);
    }
  }
  const nodes: FolderNode[] = [];
  const visit = (
    list: readonly FolderNodePreset[],
    parentFolderId: string | null,
    parentPath: string,
  ): void => {
    list.forEach((preset, index) => {
      const name = preset.name.trim();
      const relativePath = parentPath ? `${parentPath}/${name}` : name;
      const existing = currentByPath.get(relativePath.toLowerCase());
      const folderId = existing?.folderId ?? generateId();
      nodes.push({
        folderId,
        parentFolderId,
        name,
        displayOrder: index,
        enabled: true,
        semanticRole: existing?.semanticRole ?? null,
      });
      visit(preset.children, folderId, relativePath);
    });
  };
  visit(folders, null, '');
  return {
    schemaVersion: '1.0',
    sourceProfile: current?.sourceProfile ?? null,
    folders: nodes,
  };
}

/** Folder IDs present in the current snapshot but missing from a rebuilt snapshot. */
export function lostFolderIds(
  current: ProjectFolderSnapshot,
  rebuilt: ProjectFolderSnapshot,
): string[] {
  const rebuiltIds = new Set(rebuilt.folders.map((folder) => folder.folderId));
  return current.folders
    .map((folder) => folder.folderId)
    .filter((folderId) => !rebuiltIds.has(folderId));
}

/** Renames a folder node in memory while keeping its stable folderId. */
export function renameFolderInSnapshot(
  snapshot: ProjectFolderSnapshot,
  folderId: string,
  newName: string,
): ProjectFolderSnapshot {
  const name = newName.trim();
  if (!name) {
    throw new DomainError('VALIDATION_ERROR', 'Folder name is required.', 400);
  }
  const target = snapshot.folders.find((folder) => folder.folderId === folderId);
  if (!target) {
    throw new DomainError('VALIDATION_ERROR', `Unknown folderId: ${folderId}`, 400);
  }
  const siblingConflict = snapshot.folders.some(
    (folder) =>
      folder.folderId !== folderId &&
      folder.parentFolderId === target.parentFolderId &&
      folder.name.trim().toLowerCase() === name.toLowerCase(),
  );
  if (siblingConflict) {
    throw new DomainError(
      'VALIDATION_ERROR',
      `Duplicate folder name at the same level: ${name}`,
      400,
    );
  }
  const folders = snapshot.folders.map((folder) =>
    folder.folderId === folderId ? { ...folder, name } : folder,
  );
  const updated: ProjectFolderSnapshot = { ...snapshot, folders };
  validateFolderSnapshot(updated);
  return updated;
}

/** Validates snapshot identity rules: unique IDs, existing parents, no cycles. */
export function validateFolderSnapshot(snapshot: ProjectFolderSnapshot): void {
  const ids = new Set<string>();
  for (const folder of snapshot.folders) {
    if (!folder.folderId) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Every folder node requires a stable folderId.',
        400,
      );
    }
    if (ids.has(folder.folderId)) {
      throw new DomainError('VALIDATION_ERROR', `Duplicate folderId: ${folder.folderId}`, 400);
    }
    ids.add(folder.folderId);
  }
  const byId = new Map(snapshot.folders.map((folder) => [folder.folderId, folder]));
  for (const folder of snapshot.folders) {
    if (folder.parentFolderId !== null && !byId.has(folder.parentFolderId)) {
      throw new DomainError(
        'VALIDATION_ERROR',
        `Folder ${folder.folderId} references a missing parent ${folder.parentFolderId}.`,
        400,
      );
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (folderId: string): void => {
    if (visited.has(folderId)) return;
    if (visiting.has(folderId)) {
      throw new DomainError('VALIDATION_ERROR', 'Folder hierarchy contains a cycle.', 400);
    }
    visiting.add(folderId);
    const folder = byId.get(folderId);
    if (folder?.parentFolderId) visit(folder.parentFolderId);
    visiting.delete(folderId);
    visited.add(folderId);
  };
  for (const folder of snapshot.folders) visit(folder.folderId);
}

/** Derives the relative path of a folder from its hierarchy and names. */
export function deriveFolderRelativePath(
  snapshot: ProjectFolderSnapshot,
  folderId: string,
): string | null {
  const byId = new Map(snapshot.folders.map((folder) => [folder.folderId, folder]));
  const segments: string[] = [];
  let current = byId.get(folderId);
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current.folderId)) return null;
    seen.add(current.folderId);
    segments.unshift(current.name);
    current = current.parentFolderId ? byId.get(current.parentFolderId) : undefined;
  }
  return segments.length ? segments.join('/') : null;
}

/** Deterministic canonical ordering: parents before children, siblings by displayOrder. */
export function orderFolderNodes(snapshot: ProjectFolderSnapshot): FolderNode[] {
  const byParent = new Map<string | null, FolderNode[]>();
  for (const node of snapshot.folders) {
    const siblings = byParent.get(node.parentFolderId) ?? [];
    siblings.push(node);
    byParent.set(node.parentFolderId, siblings);
  }
  for (const siblings of byParent.values()) {
    siblings.sort((left, right) => left.displayOrder - right.displayOrder);
  }
  const ordered: FolderNode[] = [];
  const visit = (parentFolderId: string | null): void => {
    for (const node of byParent.get(parentFolderId) ?? []) {
      ordered.push(node);
      visit(node.folderId);
    }
  };
  visit(null);
  return ordered;
}

/** Legacy-compatible preset tree derived from a canonical snapshot. */
export function folderStructureFromSnapshot(snapshot: ProjectFolderSnapshot): FolderNodePreset[] {
  const byParent = new Map<string | null, FolderNode[]>();
  for (const node of snapshot.folders) {
    const siblings = byParent.get(node.parentFolderId) ?? [];
    siblings.push(node);
    byParent.set(node.parentFolderId, siblings);
  }
  for (const siblings of byParent.values()) {
    siblings.sort((left, right) => left.displayOrder - right.displayOrder);
  }
  const build = (parentFolderId: string | null): FolderNodePreset[] =>
    (byParent.get(parentFolderId) ?? []).map((node) => ({
      name: node.name,
      children: build(node.folderId),
    }));
  return build(null);
}

/** Builds a preset tree from a legacy flat path list. */
function presetsFromPathList(paths: readonly string[]): FolderNodePreset[] {
  const root: FolderNodePreset[] = [];
  for (const raw of paths) {
    const normalized = normalizeLegacyFolderPath(raw);
    if (!normalized) continue;
    const segments = normalized.split('/');
    let level = root;
    for (const segment of segments) {
      let node = level.find((candidate) => candidate.name.toLowerCase() === segment.toLowerCase());
      if (!node) {
        node = { name: segment, children: [] };
        level.push(node);
      }
      level = node.children;
    }
  }
  return root;
}

/** Normalizes legacy folder JSON (preset tree, path list, or fallback). */
function normalizeLegacyFolders(raw: unknown, fallback: FolderNodePreset[]): FolderNodePreset[] {
  if (!Array.isArray(raw) || raw.length === 0) return structuredClone(fallback);
  if (raw.every((entry) => typeof entry === 'string')) {
    return presetsFromPathList(raw as string[]);
  }
  const presets: FolderNodePreset[] = [];
  for (const entry of raw) {
    if (entry && typeof entry === 'object') {
      const record = entry as Record<string, unknown>;
      const name = typeof record.name === 'string' && record.name.trim() ? record.name.trim() : '';
      if (name) {
        const children = Array.isArray(record.children)
          ? normalizeLegacyFolders(record.children, [])
          : [];
        presets.push({ name, children });
      }
    }
  }
  return presets.length ? presets : structuredClone(fallback);
}

/** Adapts legacy folder JSON into a canonical snapshot with deterministic IDs. */
export function adaptLegacyFolderStructure(
  projectId: string,
  raw: unknown,
  fallback: FolderNodePreset[],
): ProjectFolderSnapshot {
  const presets = normalizeLegacyFolders(raw, fallback);
  const nodes: FolderNode[] = [];
  const visit = (
    list: readonly FolderNodePreset[],
    parentFolderId: string | null,
    parentPath: string,
  ): void => {
    list.forEach((preset, index) => {
      const name = preset.name.trim();
      const relativePath = parentPath ? `${parentPath}/${name}` : name;
      const folderId = legacyFolderId(projectId, relativePath);
      nodes.push({
        folderId,
        parentFolderId,
        name,
        displayOrder: index,
        enabled: true,
        semanticRole: null,
      });
      visit(preset.children, folderId, relativePath);
    });
  };
  visit(presets, null, '');
  return { schemaVersion: '1.0', sourceProfile: null, folders: nodes };
}

/** Resolves a legacy output destination to a unique folder node, or null. */
export function resolveLegacyOutputDestination(
  snapshot: ProjectFolderSnapshot,
  rawPath: string,
): FolderNode | null {
  const normalized = normalizeLegacyFolderPath(rawPath);
  if (!normalized) return null;
  const pathMatches = snapshot.folders.filter((folder) => {
    const derived = deriveFolderRelativePath(snapshot, folder.folderId);
    return derived !== null && derived.toLowerCase() === normalized.toLowerCase();
  });
  if (pathMatches.length === 1) return pathMatches[0]!;
  if (pathMatches.length > 1) return null;
  const nameMatches = snapshot.folders.filter(
    (folder) => folder.name.trim().toLowerCase() === normalized.toLowerCase(),
  );
  return nameMatches.length === 1 ? nameMatches[0]! : null;
}

/** Builds canonical output mappings from a validated output folder record. */
export function buildOutputMappings(
  outputFolders: ProjectOutputFolders,
  snapshot: ProjectFolderSnapshot,
): OutputMapping[] {
  return Object.entries(outputFolders).map(([outputTypeId, path]) => {
    const destination = resolveLegacyOutputDestination(snapshot, path);
    return {
      outputTypeId,
      destinationFolderId: destination?.folderId ?? null,
      unresolved: destination === null,
      legacyPath: destination === null ? path : null,
    };
  });
}

/** Normalizes a legacy output record (key to path) with per-key fallback. */
function legacyOutputRecord(raw: unknown, fallback: ProjectOutputFolders): Record<string, string> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const record: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === 'string' && value.trim()) record[key] = value.trim();
    }
    return record;
  }
  return { ...fallback };
}

/** Adapts a legacy output record into canonical mappings (resolved or explicit unresolved). */
export function adaptLegacyOutputMappings(
  raw: unknown,
  snapshot: ProjectFolderSnapshot,
  fallback: ProjectOutputFolders,
): OutputMapping[] {
  const record = legacyOutputRecord(raw, fallback);
  return Object.entries(record).map(([outputTypeId, path]) => {
    const destination = resolveLegacyOutputDestination(snapshot, path);
    return {
      outputTypeId,
      destinationFolderId: destination?.folderId ?? null,
      unresolved: destination === null,
      legacyPath: destination === null ? path : null,
    };
  });
}

/** Rebuilds canonical mappings, preserving unknown output types from the current set. */
export function rebuildOutputMappings(
  current: readonly OutputMapping[],
  snapshot: ProjectFolderSnapshot,
  outputFolders: ProjectOutputFolders,
): OutputMapping[] {
  const known = new Set<string>(knownOutputTypeIds);
  const result: OutputMapping[] = Object.entries(outputFolders).map(([outputTypeId, path]) => {
    const destination = resolveLegacyOutputDestination(snapshot, path);
    return {
      outputTypeId,
      destinationFolderId: destination?.folderId ?? null,
      unresolved: destination === null,
      legacyPath: destination === null ? path : null,
    };
  });
  for (const mapping of current) {
    if (
      !known.has(mapping.outputTypeId) &&
      !result.some((candidate) => candidate.outputTypeId === mapping.outputTypeId)
    ) {
      result.push(mapping);
    }
  }
  return result;
}

/** Legacy-compatible output folder view derived from canonical mappings. */
export function outputFoldersFromMappings(
  mappings: readonly OutputMapping[],
  snapshot: ProjectFolderSnapshot,
  fallback: ProjectOutputFolders,
): ProjectOutputFolders {
  const result = { ...fallback };
  for (const key of knownOutputTypeIds) {
    const mapping = mappings.find((candidate) => candidate.outputTypeId === key);
    if (mapping && !mapping.unresolved && mapping.destinationFolderId) {
      const derived = deriveFolderRelativePath(snapshot, mapping.destinationFolderId);
      result[key] = derived ?? '';
    } else {
      result[key] = '';
    }
  }
  return result;
}

/** Legacy-compatible output folder view preserving the stored record with per-key fallback. */
export function legacyOutputFoldersView(
  record: Record<string, string>,
  fallback: ProjectOutputFolders,
): ProjectOutputFolders {
  const result = { ...fallback };
  for (const key of knownOutputTypeIds) {
    const value = record[key];
    if (value) result[key] = value;
  }
  return result;
}

/** Sanitizes legacy path evidence so absolute paths are never exposed in responses. */
export function sanitizeLegacyPath(value: string | null): string | null {
  if (!value) return null;
  const normalized = normalizeLegacyFolderPath(value);
  return normalized || null;
}

// ===========================================================================
// P2.4B2 - Controlled ID-aware folder structure operations
// ===========================================================================

const windowsReservedDeviceNames = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
]);

/** Validates a Windows folder name segment and returns it unchanged. */
export function validateWindowsFolderName(name: string): string {
  if (!name || !name.trim()) {
    throw new DomainError('VALIDATION_ERROR', 'Folder name is required.', 400);
  }
  if (name !== name.trim()) {
    throw new DomainError(
      'VALIDATION_ERROR',
      'Folder names cannot start or end with whitespace.',
      400,
    );
  }
  if (name === '.' || name === '..') {
    throw new DomainError('VALIDATION_ERROR', `Invalid folder name: ${name}`, 400);
  }
  if (/[<>:"/\\|?*]/.test(name)) {
    throw new DomainError('VALIDATION_ERROR', `Invalid folder name: ${name}`, 400);
  }
  if ([...name].some((character) => character.charCodeAt(0) < 32)) {
    throw new DomainError('VALIDATION_ERROR', `Invalid folder name: ${name}`, 400);
  }
  if (name.endsWith('.') || name.endsWith(' ')) {
    throw new DomainError('VALIDATION_ERROR', `Invalid folder name: ${name}`, 400);
  }
  const base = name.split('.')[0]!.toUpperCase();
  if (windowsReservedDeviceNames.has(base)) {
    throw new DomainError('VALIDATION_ERROR', `Reserved Windows device name: ${name}`, 400);
  }
  if (name.length > 120) {
    throw new DomainError('VALIDATION_ERROR', 'Folder name is too long.', 400);
  }
  return name;
}

/** Deterministic fingerprint of the current folder configuration. */
export function folderConfigurationFingerprint(
  snapshot: ProjectFolderSnapshot,
  mappings: readonly OutputMapping[],
): string {
  const lines: string[] = [];
  for (const folder of orderFolderNodes(snapshot)) {
    lines.push(
      `folder:${folder.folderId}|parent:${folder.parentFolderId ?? ''}|name:${folder.name}|order:${folder.displayOrder}|enabled:${folder.enabled}`,
    );
  }
  for (const mapping of [...mappings].sort((left, right) =>
    left.outputTypeId.localeCompare(right.outputTypeId),
  )) {
    lines.push(
      `mapping:${mapping.outputTypeId}|dest:${mapping.destinationFolderId ?? ''}|unresolved:${mapping.unresolved}`,
    );
  }
  return fnv1a64(lines.join('\n'));
}

/** True when the node exists and every ancestor is enabled. */
export function isFolderEffectivelyEnabled(
  snapshot: ProjectFolderSnapshot,
  folderId: string,
): boolean {
  const byId = new Map(snapshot.folders.map((folder) => [folder.folderId, folder]));
  const start = byId.get(folderId);
  if (!start) return false;
  let current: FolderNode | undefined = start;
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current.folderId)) return false;
    seen.add(current.folderId);
    if (!current.enabled) return false;
    current = current.parentFolderId ? byId.get(current.parentFolderId) : undefined;
  }
  return true;
}

/** All descendant folder IDs of a node, excluding the node itself. */
export function folderDescendantIds(snapshot: ProjectFolderSnapshot, folderId: string): string[] {
  const byParent = new Map<string | null, FolderNode[]>();
  for (const node of snapshot.folders) {
    const siblings = byParent.get(node.parentFolderId) ?? [];
    siblings.push(node);
    byParent.set(node.parentFolderId, siblings);
  }
  const result: string[] = [];
  const visit = (parentId: string): void => {
    for (const child of byParent.get(parentId) ?? []) {
      result.push(child.folderId);
      visit(child.folderId);
    }
  };
  visit(folderId);
  return result;
}

/** Output mappings that reference the node or any descendant. */
export function folderSubtreeMappings(
  mappings: readonly OutputMapping[],
  snapshot: ProjectFolderSnapshot,
  folderId: string,
): OutputMapping[] {
  const ids = new Set([folderId, ...folderDescendantIds(snapshot, folderId)]);
  return mappings.filter(
    (mapping) => mapping.destinationFolderId !== null && ids.has(mapping.destinationFolderId),
  );
}

/** True when a sibling with the same case-insensitive name already exists. */
export function folderSiblingNameCollision(
  snapshot: ProjectFolderSnapshot,
  parentFolderId: string | null,
  name: string,
  excludeFolderId?: string,
): boolean {
  const normalized = name.trim().toLowerCase();
  return snapshot.folders.some(
    (folder) =>
      folder.parentFolderId === parentFolderId &&
      folder.folderId !== excludeFolderId &&
      folder.name.trim().toLowerCase() === normalized,
  );
}

/** Adds a folder node to the snapshot with a stable generated ID. */
export function addFolderToSnapshot(
  snapshot: ProjectFolderSnapshot,
  parentFolderId: string | null,
  name: string,
  displayOrder: number,
  folderId: string,
): ProjectFolderSnapshot {
  const node: FolderNode = {
    folderId,
    parentFolderId,
    name,
    displayOrder,
    enabled: true,
    semanticRole: null,
  };
  const updated: ProjectFolderSnapshot = { ...snapshot, folders: [...snapshot.folders, node] };
  validateFolderSnapshot(updated);
  return updated;
}

/** Moves a node to a new parent, preserving node and descendant identities. */
export function moveFolderInSnapshot(
  snapshot: ProjectFolderSnapshot,
  folderId: string,
  newParentFolderId: string | null,
): ProjectFolderSnapshot {
  const target = snapshot.folders.find((folder) => folder.folderId === folderId);
  if (!target) {
    throw new DomainError('VALIDATION_ERROR', `Unknown folderId: ${folderId}`, 400);
  }
  if (folderId === newParentFolderId) {
    throw new DomainError('VALIDATION_ERROR', 'A folder cannot be moved into itself.', 400);
  }
  if (newParentFolderId !== null) {
    const parent = snapshot.folders.find((folder) => folder.folderId === newParentFolderId);
    if (!parent) {
      throw new DomainError(
        'VALIDATION_ERROR',
        `Unknown parent folderId: ${newParentFolderId}`,
        400,
      );
    }
    if (folderDescendantIds(snapshot, folderId).includes(newParentFolderId)) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'A folder cannot be moved into its own descendant.',
        400,
      );
    }
  }
  const siblings = snapshot.folders
    .filter((folder) => folder.parentFolderId === newParentFolderId)
    .sort((left, right) => left.displayOrder - right.displayOrder);
  const displayOrder = siblings.length ? siblings[siblings.length - 1]!.displayOrder + 1 : 0;
  const folders = snapshot.folders.map((folder) =>
    folder.folderId === folderId
      ? { ...folder, parentFolderId: newParentFolderId, displayOrder }
      : folder,
  );
  const updated: ProjectFolderSnapshot = { ...snapshot, folders };
  validateFolderSnapshot(updated);
  return updated;
}

/** Removes a leaf node from the snapshot. */
export function removeFolderFromSnapshot(
  snapshot: ProjectFolderSnapshot,
  folderId: string,
): ProjectFolderSnapshot {
  const target = snapshot.folders.find((folder) => folder.folderId === folderId);
  if (!target) {
    throw new DomainError('VALIDATION_ERROR', `Unknown folderId: ${folderId}`, 400);
  }
  if (snapshot.folders.some((folder) => folder.parentFolderId === folderId)) {
    throw new DomainError('VALIDATION_ERROR', 'Only empty folders can be removed.', 400);
  }
  const updated: ProjectFolderSnapshot = {
    ...snapshot,
    folders: snapshot.folders.filter((folder) => folder.folderId !== folderId),
  };
  validateFolderSnapshot(updated);
  return updated;
}

/** Sets the enabled flag on a node without touching descendants. */
export function setFolderEnabledInSnapshot(
  snapshot: ProjectFolderSnapshot,
  folderId: string,
  enabled: boolean,
): ProjectFolderSnapshot {
  const target = snapshot.folders.find((folder) => folder.folderId === folderId);
  if (!target) {
    throw new DomainError('VALIDATION_ERROR', `Unknown folderId: ${folderId}`, 400);
  }
  const updated: ProjectFolderSnapshot = {
    ...snapshot,
    folders: snapshot.folders.map((folder) =>
      folder.folderId === folderId ? { ...folder, enabled } : folder,
    ),
  };
  validateFolderSnapshot(updated);
  return updated;
}

/** Reorders a node among its siblings by displayOrder only. */
export function reorderSiblingInSnapshot(
  snapshot: ProjectFolderSnapshot,
  folderId: string,
  newDisplayOrder: number,
): ProjectFolderSnapshot {
  const target = snapshot.folders.find((folder) => folder.folderId === folderId);
  if (!target) {
    throw new DomainError('VALIDATION_ERROR', `Unknown folderId: ${folderId}`, 400);
  }
  const siblings = snapshot.folders
    .filter((folder) => folder.parentFolderId === target.parentFolderId)
    .sort((left, right) => left.displayOrder - right.displayOrder);
  const maxOrder = siblings.length ? siblings[siblings.length - 1]!.displayOrder : 0;
  const order = Math.max(0, Math.min(newDisplayOrder, maxOrder));
  const ordered = siblings.filter((folder) => folder.folderId !== folderId);
  ordered.splice(order, 0, target);
  const byId = new Map(ordered.map((folder, index) => [folder.folderId, index]));
  const folders = snapshot.folders.map((folder) =>
    folder.parentFolderId === target.parentFolderId
      ? { ...folder, displayOrder: byId.get(folder.folderId) ?? folder.displayOrder }
      : folder,
  );
  const updated: ProjectFolderSnapshot = { ...snapshot, folders };
  validateFolderSnapshot(updated);
  return updated;
}

/** Number of nodes in the subtree including the node itself. */
export function folderSubtreeCount(snapshot: ProjectFolderSnapshot, folderId: string): number {
  return 1 + folderDescendantIds(snapshot, folderId).length;
}

// ===========================================================================
// P2.4B3A - Folder Profile catalog and template identity foundation
// ===========================================================================

export const folderProfileSchemaVersions = ['1.0'] as const;
export type FolderProfileSchemaVersion = (typeof folderProfileSchemaVersions)[number];

/** Stable identity for a folder node inside a Folder Profile template. */
export interface ProfileFolderNode {
  profileFolderId: string;
  parentProfileFolderId: string | null;
  name: string;
  displayOrder: number;
  semanticRole: string | null;
}

/** Output type to profile-folder destination mapping inside a template. */
export interface ProfileOutputDefault {
  outputTypeId: string;
  destinationProfileFolderId: string;
}

/** Persistent user Folder Profile template. Never touches the filesystem. */
export interface FolderProfile {
  schemaVersion: FolderProfileSchemaVersion;
  profileId: string;
  name: string;
  description: string | null;
  folders: ProfileFolderNode[];
  outputDefaults: ProfileOutputDefault[];
  structuralFingerprint: string;
  createdAt: string;
  updatedAt: string;
}

/** Canonical unified default reference: blank, built-in factory, or canonical user profile. */
export type FolderProfileRef =
  | { kind: 'blank' }
  | { kind: 'factory'; factoryProfileKey: string }
  | { kind: 'user'; profileId: string };
/** Catalog-level state: user profiles plus the canonical unified default reference. */
export interface FolderProfileCatalog {
  schemaVersion: FolderProfileSchemaVersion;
  profiles: FolderProfile[];
  defaultProfileRef: FolderProfileRef;
}

/** Draft tree node used by create/update contracts before IDs are assigned. */
export interface ProfileFolderNodeDraft {
  profileFolderId?: string | null | undefined;
  name: string;
  semanticRole?: string | null | undefined;
  children: ProfileFolderNodeDraft[];
}

/** Draft output default expressed as a relative path before IDs exist. */
export interface ProfileOutputDefaultDraft {
  outputTypeId: string;
  destinationPath: string;
}

/** Result of the pure profile-to-project instantiation primitive. */
export interface ProfileInstantiationResult {
  snapshot: ProjectFolderSnapshot;
  outputMappings: ProjectOutputMappings;
}

/** Normalizes a profile name and enforces the shared length rule. */
export function validateProfileName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new DomainError('VALIDATION_ERROR', 'Profile name is required.', 400);
  }
  if (trimmed.length > 120) {
    throw new DomainError('VALIDATION_ERROR', 'Profile name is too long.', 400);
  }
  return trimmed;
}

/** Case-insensitive normalized key used for user-profile name uniqueness. */
export function normalizeProfileName(name: string): string {
  return name.trim().toLowerCase();
}
/** Canonical blank default reference. */
export function blankFolderProfileRef(): FolderProfileRef {
  return { kind: 'blank' };
}
/** Canonical factory default reference with an explicit stable machine key. */
export function factoryFolderProfileRef(factoryProfileKey: string): FolderProfileRef {
  const key = factoryProfileKey.trim();
  if (!key) {
    throw new DomainError('VALIDATION_ERROR', 'Factory profile key is required.', 400);
  }
  return { kind: 'factory', factoryProfileKey: key };
}
/** Canonical user default reference keyed by the canonical profile UUID. */
export function userFolderProfileRef(profileId: string): FolderProfileRef {
  const id = profileId.trim();
  if (!id) {
    throw new DomainError('VALIDATION_ERROR', 'Profile ID is required.', 400);
  }
  return { kind: 'user', profileId: id };
}
/**
 * Validates a canonical default reference. Factory keys are checked against
 * the built-in factory registry; user profile IDs against the canonical
 * catalog. Historical legacy profiles have no canonical default reference.
 */
export function validateFolderProfileRef(
  ref: FolderProfileRef,
  registry: { profileIds: ReadonlySet<string>; factoryKeys: ReadonlySet<string> },
): void {
  switch (ref.kind) {
    case 'blank':
      return;
    case 'factory':
      if (!ref.factoryProfileKey || !ref.factoryProfileKey.trim()) {
        throw new DomainError('VALIDATION_ERROR', 'Factory profile key is required.', 400);
      }
      if (!registry.factoryKeys.has(ref.factoryProfileKey)) {
        throw new DomainError(
          'VALIDATION_ERROR',
          `Unknown factory profile key: ${ref.factoryProfileKey}`,
          400,
        );
      }
      return;
    case 'user':
      if (!ref.profileId || !ref.profileId.trim()) {
        throw new DomainError('VALIDATION_ERROR', 'Profile ID is required.', 400);
      }
      if (!registry.profileIds.has(ref.profileId)) {
        throw new DomainError(
          'VALIDATION_ERROR',
          'Default profile must reference an existing user profile.',
          400,
        );
      }
      return;
  }
}
/** Builds a snapshot source record for a built-in factory profile by stable key. */
export function factoryProfileSource(
  factoryProfileKey: string,
  profileName: string,
  structuralFingerprint: string,
): FolderProfileSource {
  return {
    profileId: null,
    profileName,
    profileRevision: null,
    structuralFingerprint,
    factoryProfileKey,
  };
}

/** Depth of a profile folder node (root depth is 1). */
export function profileFolderDepth(
  folders: readonly ProfileFolderNode[],
  profileFolderId: string,
): number {
  const byId = new Map(folders.map((folder) => [folder.profileFolderId, folder]));
  let depth = 0;
  let current = byId.get(profileFolderId);
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current.profileFolderId)) return depth;
    seen.add(current.profileFolderId);
    depth += 1;
    current = current.parentProfileFolderId ? byId.get(current.parentProfileFolderId) : undefined;
  }
  return depth;
}

/** Validates profile folder node identity, hierarchy, names, and ordering. */
export function validateProfileFolderNodes(folders: readonly ProfileFolderNode[]): void {
  if (!folders.length) {
    throw new DomainError('VALIDATION_ERROR', 'Add at least one profile folder.', 400);
  }
  if (folders.length > 300) {
    throw new DomainError('VALIDATION_ERROR', 'A profile can contain up to 300 folders.', 400);
  }
  const ids = new Set<string>();
  const byId = new Map<string, ProfileFolderNode>();
  for (const node of folders) {
    if (!node.profileFolderId || !node.profileFolderId.trim()) {
      throw new DomainError('VALIDATION_ERROR', 'Profile folder ID is required.', 400);
    }
    if (ids.has(node.profileFolderId)) {
      throw new DomainError(
        'VALIDATION_ERROR',
        `Duplicate profile folder ID: ${node.profileFolderId}`,
        400,
      );
    }
    ids.add(node.profileFolderId);
    byId.set(node.profileFolderId, node);
    validateWindowsFolderName(node.name);
    if (!Number.isInteger(node.displayOrder) || node.displayOrder < 0) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Profile folder display order must be a non-negative integer.',
        400,
      );
    }
    if (node.semanticRole && node.semanticRole.length > 120) {
      throw new DomainError('VALIDATION_ERROR', 'Profile folder semantic role is too long.', 400);
    }
  }
  for (const node of folders) {
    if (node.parentProfileFolderId === null) continue;
    if (!byId.has(node.parentProfileFolderId)) {
      throw new DomainError(
        'VALIDATION_ERROR',
        `Unknown parent profile folder ID: ${node.parentProfileFolderId}`,
        400,
      );
    }
    if (node.parentProfileFolderId === node.profileFolderId) {
      throw new DomainError('VALIDATION_ERROR', 'A profile folder cannot be its own parent.', 400);
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (profileFolderId: string): void => {
    if (visited.has(profileFolderId)) return;
    if (visiting.has(profileFolderId)) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Profile folder hierarchy cannot contain cycles.',
        400,
      );
    }
    visiting.add(profileFolderId);
    const node = byId.get(profileFolderId);
    if (node?.parentProfileFolderId) visit(node.parentProfileFolderId);
    visiting.delete(profileFolderId);
    visited.add(profileFolderId);
  };
  for (const node of folders) visit(node.profileFolderId);
  const siblingOrders = new Map<string | null, Set<number>>();
  for (const node of folders) {
    const orders = siblingOrders.get(node.parentProfileFolderId) ?? new Set<number>();
    if (orders.has(node.displayOrder)) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Profile folder display order must be unique among siblings.',
        400,
      );
    }
    orders.add(node.displayOrder);
    siblingOrders.set(node.parentProfileFolderId, orders);
  }
  for (const node of folders) {
    if (profileFolderDepth(folders, node.profileFolderId) > 8) {
      throw new DomainError('VALIDATION_ERROR', 'Folder nesting cannot exceed 8 levels.', 400);
    }
  }
}

/** Validates profile output defaults against the same profile folder set. */
export function validateProfileOutputDefaults(
  outputDefaults: readonly ProfileOutputDefault[],
  folders: readonly ProfileFolderNode[],
): void {
  const ids = new Set(folders.map((folder) => folder.profileFolderId));
  const seen = new Set<string>();
  for (const outputDefault of outputDefaults) {
    if (!outputDefault.outputTypeId || !outputDefault.outputTypeId.trim()) {
      throw new DomainError('VALIDATION_ERROR', 'Output type ID is required.', 400);
    }
    if (seen.has(outputDefault.outputTypeId)) {
      throw new DomainError(
        'VALIDATION_ERROR',
        `Duplicate output default for ${outputDefault.outputTypeId}.`,
        400,
      );
    }
    seen.add(outputDefault.outputTypeId);
    if (!ids.has(outputDefault.destinationProfileFolderId)) {
      throw new DomainError(
        'VALIDATION_ERROR',
        `Output default ${outputDefault.outputTypeId} must target a folder in the same profile.`,
        400,
      );
    }
  }
}

/** Validates a complete canonical Folder Profile. */
export function validateFolderProfile(profile: FolderProfile): void {
  if (!profile.profileId || !profile.profileId.trim()) {
    throw new DomainError('VALIDATION_ERROR', 'Profile ID is required.', 400);
  }
  validateProfileName(profile.name);
  validateProfileFolderNodes(profile.folders);
  validateProfileOutputDefaults(profile.outputDefaults, profile.folders);
  if (!profile.structuralFingerprint || !profile.structuralFingerprint.trim()) {
    throw new DomainError('VALIDATION_ERROR', 'Profile structural fingerprint is required.', 400);
  }
}

/** Deterministic profile folder ordering: parents before children, siblings by displayOrder. */
export function orderProfileFolderNodes(
  folders: readonly ProfileFolderNode[],
): ProfileFolderNode[] {
  const byParent = new Map<string | null, ProfileFolderNode[]>();
  for (const node of folders) {
    const siblings = byParent.get(node.parentProfileFolderId) ?? [];
    siblings.push(node);
    byParent.set(node.parentProfileFolderId, siblings);
  }
  for (const siblings of byParent.values()) {
    siblings.sort((left, right) => left.displayOrder - right.displayOrder);
  }
  const ordered: ProfileFolderNode[] = [];
  const visit = (parentProfileFolderId: string | null): void => {
    for (const node of byParent.get(parentProfileFolderId) ?? []) {
      ordered.push(node);
      visit(node.profileFolderId);
    }
  };
  visit(null);
  return ordered;
}

/** Relative path of a profile folder node within the profile, or null on cycles. */
export function deriveProfileFolderPath(
  folders: readonly ProfileFolderNode[],
  profileFolderId: string,
): string | null {
  const byId = new Map(folders.map((folder) => [folder.profileFolderId, folder]));
  const segments: string[] = [];
  let current = byId.get(profileFolderId);
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current.profileFolderId)) return null;
    seen.add(current.profileFolderId);
    segments.unshift(current.name);
    current = current.parentProfileFolderId ? byId.get(current.parentProfileFolderId) : undefined;
  }
  return segments.length ? segments.join('/') : null;
}

/** Resolves a relative path to a profile folder node (case-insensitive, unique). */
export function resolveProfileFolderByPath(
  folders: readonly ProfileFolderNode[],
  path: string,
): ProfileFolderNode | null {
  const normalized = path.trim().replaceAll('\\', '/');
  const matches = folders.filter((node) => {
    const derived = deriveProfileFolderPath(folders, node.profileFolderId);
    return derived !== null && derived.toLowerCase() === normalized.toLowerCase();
  });
  return matches.length === 1 ? matches[0]! : null;
}

/** Deterministic structural fingerprint of a profile template. */
export function profileStructuralFingerprint(
  folders: readonly ProfileFolderNode[],
  outputDefaults: readonly ProfileOutputDefault[],
): string {
  const lines: string[] = [];
  for (const node of orderProfileFolderNodes(folders)) {
    lines.push(
      `folder:${node.profileFolderId}|parent:${node.parentProfileFolderId ?? ''}|name:${node.name}|order:${node.displayOrder}|role:${node.semanticRole ?? ''}`,
    );
  }
  for (const outputDefault of [...outputDefaults].sort((left, right) =>
    left.outputTypeId.localeCompare(right.outputTypeId),
  )) {
    lines.push(`output:${outputDefault.outputTypeId}=${outputDefault.destinationProfileFolderId}`);
  }
  return fnv1a64(lines.join('\n'));
}

/** Builds profile folder nodes from a draft tree, preserving known IDs on update. */
export function buildProfileFolderNodes(
  drafts: readonly ProfileFolderNodeDraft[],
  existing: ReadonlyMap<string, ProfileFolderNode>,
  generateId: () => string,
): ProfileFolderNode[] {
  const nodes: ProfileFolderNode[] = [];
  const visit = (
    list: readonly ProfileFolderNodeDraft[],
    parentProfileFolderId: string | null,
  ): void => {
    list.forEach((draft, index) => {
      let profileFolderId: string;
      if (draft.profileFolderId) {
        if (!existing.has(draft.profileFolderId)) {
          throw new DomainError(
            'VALIDATION_ERROR',
            `Unknown profile folder ID: ${draft.profileFolderId}`,
            400,
          );
        }
        profileFolderId = draft.profileFolderId;
      } else {
        profileFolderId = generateId();
      }
      nodes.push({
        profileFolderId,
        parentProfileFolderId,
        name: draft.name.trim(),
        displayOrder: index,
        semanticRole: draft.semanticRole?.trim() || null,
      });
      visit(draft.children, profileFolderId);
    });
  };
  visit(drafts, null);
  return nodes;
}

/** Resolves draft output defaults to profile folder IDs after node construction. */
export function resolveProfileOutputDefaults(
  drafts: readonly ProfileOutputDefaultDraft[],
  folders: readonly ProfileFolderNode[],
): ProfileOutputDefault[] {
  return drafts.map((draft) => {
    const destination = resolveProfileFolderByPath(folders, draft.destinationPath);
    if (!destination) {
      throw new DomainError(
        'VALIDATION_ERROR',
        `Output default ${draft.outputTypeId} must target a folder in the profile structure.`,
        400,
      );
    }
    return {
      outputTypeId: draft.outputTypeId.trim(),
      destinationProfileFolderId: destination.profileFolderId,
    };
  });
}

/** Builds a complete canonical Folder Profile from a create/update draft. */
export function buildFolderProfile(
  input: {
    name: string;
    description?: string | null;
    folders: readonly ProfileFolderNodeDraft[];
    outputDefaults: readonly ProfileOutputDefaultDraft[];
  },
  existing: ReadonlyMap<string, ProfileFolderNode>,
  generateId: () => string,
  now: string,
  profileId: string,
): FolderProfile {
  const folders = buildProfileFolderNodes(input.folders, existing, generateId);
  const outputDefaults = resolveProfileOutputDefaults(input.outputDefaults, folders);
  const profile: FolderProfile = {
    schemaVersion: '1.0',
    profileId,
    name: validateProfileName(input.name),
    description: input.description?.trim() || null,
    folders,
    outputDefaults,
    structuralFingerprint: profileStructuralFingerprint(folders, outputDefaults),
    createdAt: now,
    updatedAt: now,
  };
  validateFolderProfile(profile);
  return profile;
}

/** Duplicates a profile with fully regenerated node identities and remapped defaults. */
export function duplicateFolderProfile(
  profile: FolderProfile,
  name: string,
  generateId: () => string,
  now: string,
): FolderProfile {
  const idMap = new Map<string, string>();
  for (const node of orderProfileFolderNodes(profile.folders)) {
    idMap.set(node.profileFolderId, generateId());
  }
  const folders: ProfileFolderNode[] = orderProfileFolderNodes(profile.folders).map((node) => ({
    profileFolderId: idMap.get(node.profileFolderId)!,
    parentProfileFolderId: node.parentProfileFolderId
      ? idMap.get(node.parentProfileFolderId)!
      : null,
    name: node.name,
    displayOrder: node.displayOrder,
    semanticRole: node.semanticRole,
  }));
  const outputDefaults: ProfileOutputDefault[] = profile.outputDefaults.map((outputDefault) => ({
    outputTypeId: outputDefault.outputTypeId,
    destinationProfileFolderId: idMap.get(outputDefault.destinationProfileFolderId)!,
  }));
  const duplicate: FolderProfile = {
    schemaVersion: profile.schemaVersion,
    profileId: generateId(),
    name: validateProfileName(name),
    description: profile.description,
    folders,
    outputDefaults,
    structuralFingerprint: profileStructuralFingerprint(folders, outputDefaults),
    createdAt: now,
    updatedAt: now,
  };
  validateFolderProfile(duplicate);
  return duplicate;
}

/** Pure profile-to-project instantiation: new project IDs, provenance only. */
export function instantiateFolderProfile(
  profile: FolderProfile,
  generateId: () => string,
): ProfileInstantiationResult {
  validateFolderProfile(profile);
  const idMap = new Map<string, string>();
  for (const node of orderProfileFolderNodes(profile.folders)) {
    idMap.set(node.profileFolderId, generateId());
  }
  const folders: FolderNode[] = orderProfileFolderNodes(profile.folders).map((node) => ({
    folderId: idMap.get(node.profileFolderId)!,
    parentFolderId: node.parentProfileFolderId ? idMap.get(node.parentProfileFolderId)! : null,
    name: node.name,
    displayOrder: node.displayOrder,
    enabled: true,
    semanticRole: node.semanticRole,
    sourceProfileFolderId: node.profileFolderId,
  }));
  const snapshot: ProjectFolderSnapshot = {
    schemaVersion: '1.0',
    sourceProfile: {
      profileId: profile.profileId,
      profileName: profile.name,
      profileRevision: null,
      structuralFingerprint: profile.structuralFingerprint,
    },
    folders,
  };
  const mappings: OutputMapping[] = profile.outputDefaults.map((outputDefault) => {
    const destinationFolderId = idMap.get(outputDefault.destinationProfileFolderId) ?? null;
    return {
      outputTypeId: outputDefault.outputTypeId,
      destinationFolderId,
      unresolved: destinationFolderId === null,
      legacyPath: null,
    };
  });
  return {
    snapshot,
    outputMappings: { schemaVersion: '1.0', mappings },
  };
}

/** Converts a canonical catalog profile into the legacy name-based preset view. */
export function folderProfileToPreset(
  profile: FolderProfile,
  fallbackOutputFolders: ProjectOutputFolders,
): FolderProfilePreset {
  const ordered = orderProfileFolderNodes(profile.folders);
  const byParent = new Map<string | null, ProfileFolderNode[]>();
  for (const node of ordered) {
    const siblings = byParent.get(node.parentProfileFolderId) ?? [];
    siblings.push(node);
    byParent.set(node.parentProfileFolderId, siblings);
  }
  const buildTree = (parent: string | null): FolderNodePreset[] =>
    (byParent.get(parent) ?? []).map((node) => ({
      name: node.name,
      children: buildTree(node.profileFolderId),
    }));
  const outputFolders: ProjectOutputFolders = { ...fallbackOutputFolders };
  for (const outputDefault of profile.outputDefaults) {
    if (outputDefault.outputTypeId in outputFolders) {
      const derived = deriveProfileFolderPath(
        profile.folders,
        outputDefault.destinationProfileFolderId,
      );
      if (derived) {
        outputFolders[outputDefault.outputTypeId as keyof ProjectOutputFolders] = derived;
      }
    }
  }
  return {
    name: profile.name,
    description: profile.description ?? '',
    folders: buildTree(null),
    outputFolders,
    builtIn: false,
  };
}

/**
 * Converts a legacy preset input into catalog drafts. Existing node IDs are
 * preserved by relative path so legacy saves never rebuild profile identities.
 *
 * P2.4B3B1A: when an existing canonical profile is saved through the legacy
 * contract (which exposes only the five known output keys), unknown/custom
 * output defaults already present in the profile are preserved unchanged and
 * only the known legacy-exposed outputs are re-applied. New profiles contain
 * only the output semantics supplied by the legacy contract.
 */
export function presetToFolderProfileDraft(
  input: {
    name: string;
    description: string;
    folders: readonly FolderNodePreset[];
    outputFolders: Record<string, string>;
  },
  existing?: FolderProfile | null,
): {
  name: string;
  description: string;
  folders: ProfileFolderNodeDraft[];
  outputDefaults: ProfileOutputDefaultDraft[];
} {
  const existingByPath = new Map<string, ProfileFolderNode>();
  if (existing) {
    for (const node of existing.folders) {
      const derived = deriveProfileFolderPath(existing.folders, node.profileFolderId);
      if (derived) existingByPath.set(derived.toLowerCase(), node);
    }
  }
  const visit = (list: readonly FolderNodePreset[], parentPath: string): ProfileFolderNodeDraft[] =>
    list.map((node) => {
      const relativePath = parentPath ? `${parentPath}/${node.name}` : node.name;
      const existingNode = existingByPath.get(relativePath.toLowerCase());
      return {
        profileFolderId: existingNode?.profileFolderId,
        name: node.name,
        children: visit(node.children, relativePath),
      };
    });
  const incoming = new Map<string, string>(Object.entries(input.outputFolders));
  const outputDefaults: ProfileOutputDefaultDraft[] = [];
  if (existing) {
    for (const outputDefault of existing.outputDefaults) {
      if (incoming.has(outputDefault.outputTypeId)) continue;
      const destinationPath = deriveProfileFolderPath(
        existing.folders,
        outputDefault.destinationProfileFolderId,
      );
      if (!destinationPath) {
        throw new DomainError(
          'VALIDATION_ERROR',
          `Cannot preserve output default ${outputDefault.outputTypeId} without a valid destination.`,
          400,
        );
      }
      outputDefaults.push({ outputTypeId: outputDefault.outputTypeId, destinationPath });
    }
  }
  for (const [outputTypeId, destinationPath] of incoming) {
    outputDefaults.push({ outputTypeId, destinationPath });
  }
  return {
    name: input.name,
    description: input.description,
    folders: visit(input.folders, ''),
    outputDefaults,
  };
}

// ===========================================================================
// P2.4B3B2A - Canonical project folder draft foundation
// ===========================================================================

/** Transient stable identity for a node inside a project folder draft. */
export interface ProjectFolderDraftNode {
  draftFolderId: string;
  parentDraftFolderId: string | null;
  name: string;
  displayOrder: number;
  semanticRole?: string | null | undefined;
  /** Provenance only: the profile folder node this draft node was derived from. */
  sourceProfileFolderId?: string | null | undefined;
}

/** Draft output mapping expressed as outputTypeId to draft folder destination. */
export interface ProjectFolderDraftOutputMapping {
  outputTypeId: string;
  destinationDraftFolderId: string;
}

/**
 * Canonical transient project folder draft. This is the user-reviewed
 * structure for one project creation. It is never a live dependency on the
 * source Folder Profile: the source profile is provenance only.
 */
export interface ProjectFolderDraft {
  folders: ProjectFolderDraftNode[];
  outputMappings: ProjectFolderDraftOutputMapping[];
  sourceProfile?: FolderProfileSource | null | undefined;
}

/** Returns the canonical empty project folder draft (managed root only). */
export function blankProjectFolderDraft(): ProjectFolderDraft {
  return { folders: [], outputMappings: [], sourceProfile: null };
}

/** Depth of a draft folder node (root depth is 1). */
export function projectFolderDraftDepth(
  folders: readonly ProjectFolderDraftNode[],
  draftFolderId: string,
): number {
  const byId = new Map(folders.map((folder) => [folder.draftFolderId, folder]));
  let depth = 0;
  let current = byId.get(draftFolderId);
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current.draftFolderId)) return depth;
    seen.add(current.draftFolderId);
    depth += 1;
    current = current.parentDraftFolderId ? byId.get(current.parentDraftFolderId) : undefined;
  }
  return depth;
}

/** Validates a canonical project folder draft before any persistence or creation. */
export function validateProjectFolderDraft(draft: ProjectFolderDraft): void {
  if (draft.folders.length > 300) {
    throw new DomainError(
      'VALIDATION_ERROR',
      'A project draft can contain up to 300 folders.',
      400,
    );
  }
  const ids = new Set<string>();
  const byId = new Map<string, ProjectFolderDraftNode>();
  for (const node of draft.folders) {
    if (!node.draftFolderId || !node.draftFolderId.trim()) {
      throw new DomainError('VALIDATION_ERROR', 'Draft folder ID is required.', 400);
    }
    if (ids.has(node.draftFolderId)) {
      throw new DomainError(
        'VALIDATION_ERROR',
        `Duplicate draft folder ID: ${node.draftFolderId}`,
        400,
      );
    }
    ids.add(node.draftFolderId);
    byId.set(node.draftFolderId, node);
    validateWindowsFolderName(node.name);
    if (!Number.isInteger(node.displayOrder) || node.displayOrder < 0) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Draft folder display order must be a non-negative integer.',
        400,
      );
    }
    if (node.semanticRole && node.semanticRole.length > 120) {
      throw new DomainError('VALIDATION_ERROR', 'Draft folder semantic role is too long.', 400);
    }
    if (node.sourceProfileFolderId && node.sourceProfileFolderId.length > 200) {
      throw new DomainError('VALIDATION_ERROR', 'Draft source profile folder ID is too long.', 400);
    }
  }
  for (const node of draft.folders) {
    if (node.parentDraftFolderId === null) continue;
    if (!byId.has(node.parentDraftFolderId)) {
      throw new DomainError(
        'VALIDATION_ERROR',
        `Draft folder ${node.draftFolderId} references a missing parent ${node.parentDraftFolderId}.`,
        400,
      );
    }
    if (node.parentDraftFolderId === node.draftFolderId) {
      throw new DomainError('VALIDATION_ERROR', 'A draft folder cannot be its own parent.', 400);
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (draftFolderId: string): void => {
    if (visited.has(draftFolderId)) return;
    if (visiting.has(draftFolderId)) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Draft folder hierarchy cannot contain cycles.',
        400,
      );
    }
    visiting.add(draftFolderId);
    const node = byId.get(draftFolderId);
    if (node?.parentDraftFolderId) visit(node.parentDraftFolderId);
    visiting.delete(draftFolderId);
    visited.add(draftFolderId);
  };
  for (const node of draft.folders) visit(node.draftFolderId);
  const siblingOrders = new Map<string | null, Set<number>>();
  const siblingNames = new Map<string | null, Set<string>>();
  for (const node of draft.folders) {
    const orders = siblingOrders.get(node.parentDraftFolderId) ?? new Set<number>();
    if (orders.has(node.displayOrder)) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Draft folder display order must be unique among siblings.',
        400,
      );
    }
    orders.add(node.displayOrder);
    siblingOrders.set(node.parentDraftFolderId, orders);
    const names = siblingNames.get(node.parentDraftFolderId) ?? new Set<string>();
    const key = node.name.trim().toLowerCase();
    if (names.has(key)) {
      throw new DomainError(
        'VALIDATION_ERROR',
        `Duplicate draft folder name at the same level: ${node.name}`,
        400,
      );
    }
    names.add(key);
    siblingNames.set(node.parentDraftFolderId, names);
  }
  for (const node of draft.folders) {
    if (projectFolderDraftDepth(draft.folders, node.draftFolderId) > 8) {
      throw new DomainError('VALIDATION_ERROR', 'Folder nesting cannot exceed 8 levels.', 400);
    }
  }
  const seenOutputs = new Set<string>();
  for (const mapping of draft.outputMappings) {
    if (!mapping.outputTypeId || !mapping.outputTypeId.trim()) {
      throw new DomainError('VALIDATION_ERROR', 'Output type ID is required.', 400);
    }
    if (seenOutputs.has(mapping.outputTypeId)) {
      throw new DomainError(
        'VALIDATION_ERROR',
        `Duplicate output mapping for ${mapping.outputTypeId}.`,
        400,
      );
    }
    seenOutputs.add(mapping.outputTypeId);
    if (!byId.has(mapping.destinationDraftFolderId)) {
      throw new DomainError(
        'VALIDATION_ERROR',
        `Output mapping ${mapping.outputTypeId} must target a folder in the same draft.`,
        400,
      );
    }
  }
}

/** Deterministic draft ordering: parents before children, siblings by displayOrder. */
export function orderProjectFolderDraftNodes(
  folders: readonly ProjectFolderDraftNode[],
): ProjectFolderDraftNode[] {
  const byParent = new Map<string | null, ProjectFolderDraftNode[]>();
  for (const node of folders) {
    const siblings = byParent.get(node.parentDraftFolderId) ?? [];
    siblings.push(node);
    byParent.set(node.parentDraftFolderId, siblings);
  }
  for (const siblings of byParent.values()) {
    siblings.sort((left, right) => left.displayOrder - right.displayOrder);
  }
  const ordered: ProjectFolderDraftNode[] = [];
  const visit = (parentDraftFolderId: string | null): void => {
    for (const node of byParent.get(parentDraftFolderId) ?? []) {
      ordered.push(node);
      visit(node.draftFolderId);
    }
  };
  visit(null);
  return ordered;
}

/** Validates persisted project output mappings against one project snapshot. */
export function validateProjectOutputMappings(
  mappings: readonly OutputMapping[],
  snapshot: ProjectFolderSnapshot,
): void {
  const ids = new Set(snapshot.folders.map((folder) => folder.folderId));
  const seen = new Set<string>();
  for (const mapping of mappings) {
    if (!mapping.outputTypeId || !mapping.outputTypeId.trim()) {
      throw new DomainError('VALIDATION_ERROR', 'Output type ID is required.', 400);
    }
    if (seen.has(mapping.outputTypeId)) {
      throw new DomainError(
        'VALIDATION_ERROR',
        `Duplicate output mapping for ${mapping.outputTypeId}.`,
        400,
      );
    }
    seen.add(mapping.outputTypeId);
    if (mapping.unresolved || !mapping.destinationFolderId) {
      throw new DomainError(
        'VALIDATION_ERROR',
        `Output mapping ${mapping.outputTypeId} must resolve to a project folder.`,
        400,
      );
    }
    if (!ids.has(mapping.destinationFolderId)) {
      throw new DomainError(
        'VALIDATION_ERROR',
        `Output mapping ${mapping.outputTypeId} must target a folder in the same project snapshot.`,
        400,
      );
    }
  }
}

/**
 * Pure draft to project instantiation. Every draft node receives a NEW project
 * folderId; parent relationships and output destinations are remapped.
 * sourceProfileFolderId is retained only as provenance. Two instantiations of
 * the same draft produce independent IDs for independent new projects.
 */
export function instantiateProjectFolderDraft(
  draft: ProjectFolderDraft,
  generateId: () => string,
): ProfileInstantiationResult {
  validateProjectFolderDraft(draft);
  const ordered = orderProjectFolderDraftNodes(draft.folders);
  const idMap = new Map<string, string>();
  for (const node of ordered) {
    idMap.set(node.draftFolderId, generateId());
  }
  const folders: FolderNode[] = ordered.map((node) => ({
    folderId: idMap.get(node.draftFolderId)!,
    parentFolderId: node.parentDraftFolderId ? idMap.get(node.parentDraftFolderId)! : null,
    name: node.name,
    displayOrder: node.displayOrder,
    enabled: true,
    semanticRole: node.semanticRole ?? null,
    sourceProfileFolderId: node.sourceProfileFolderId ?? undefined,
  }));
  const snapshot: ProjectFolderSnapshot = {
    schemaVersion: '1.0',
    sourceProfile: draft.sourceProfile ?? null,
    folders,
  };
  validateFolderSnapshot(snapshot);
  const mappings: OutputMapping[] = draft.outputMappings.map((mapping) => ({
    outputTypeId: mapping.outputTypeId,
    destinationFolderId: idMap.get(mapping.destinationDraftFolderId) ?? null,
    unresolved: false,
    legacyPath: null,
  }));
  validateProjectOutputMappings(mappings, snapshot);
  return {
    snapshot,
    outputMappings: { schemaVersion: '1.0', mappings },
  };
}

// ===========================================================================
// P2.6 — Workflow history and Revision Cycle domain models
// ===========================================================================
//
// Separation of concerns:
//   project.status            = current workflow state (sole authority)
//   WorkflowTransitionRecord  = immutable structured historical transition
//   RevisionCycle             = project-level client feedback/work loop
//   ProjectRevision           = individual document/deliverable revision
//   RevisionPackageRecord     = generated/issued package concept
//   Submission                = future official issue/transmittal entity
//
// RevisionRequired is a workflow status, NOT a RevisionCycle.
// Cycle 2 is NOT REV-02. ClientReview is NOT a Submission.

/** Canonical project-level revision-cycle lifecycle statuses. */
export const revisionCycleStatuses = ['Open', 'ReturnedToClient', 'Cancelled'] as const;
export type RevisionCycleStatus = (typeof revisionCycleStatuses)[number];

/**
 * Immutable structured workflow history record.
 *
 * Append-only. One record per actual transition. `transitionId` is a stable
 * UUID that later serves as the client-generated operation identity, retry /
 * dedupe identity, and the durable primary key. `sequence` is a per-project
 * positive integer used only for deterministic ordering, never identity.
 * `fromStatus === toStatus` no-op replays must NOT create a history row.
 */
export interface WorkflowTransitionRecord {
  transitionId: string;
  projectId: string;
  sequence: number;
  fromStatus: ProjectStatus;
  toStatus: ProjectStatus;
  occurredAt: string;
  actorId: string | null;
  reason: string | null;
  revisionCycleId: string | null;
}

/**
 * Project-level client feedback/work loop. `cycleNumber` is a project-local
 * display/order number only (later shown as "Cycle 1", "Cycle 2", ...) and is
 * NEVER an identity. `feedbackSummary` holds the same trimmed snapshot text
 * later supplied through `changeStatus.reason`.
 */
export interface RevisionCycle {
  revisionCycleId: string;
  projectId: string;
  cycleNumber: number;
  status: RevisionCycleStatus;
  openedAt: string;
  openedByTransitionId: string;
  feedbackSummary: string;
  workStartedAt: string | null;
  returnedToClientAt: string | null;
  cancelledAt: string | null;
}

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
/** Repository-standard UTC ISO 8601 timestamp, e.g. new Date().toISOString(). */
const UTC_ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function isUtcIso(value: string): boolean {
  if (!UTC_ISO_PATTERN.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

/**
 * Validates the canonical persisted form of a WorkflowTransitionRecord.
 * Throws DomainError on the first violating invariant. Used by persistence and
 * by domain tests; the request contract separately governs wire input.
 */
export function assertValidWorkflowTransitionRecord(record: WorkflowTransitionRecord): void {
  if (!isUuid(record.transitionId)) {
    throw new DomainError('VALIDATION_ERROR', 'transitionId must be a UUID.', 400);
  }
  if (!isUuid(record.projectId)) {
    throw new DomainError('VALIDATION_ERROR', 'projectId must be a UUID.', 400);
  }
  if (!Number.isInteger(record.sequence) || record.sequence < 1) {
    throw new DomainError('VALIDATION_ERROR', 'sequence must be a positive integer.', 400);
  }
  if (!projectStatuses.includes(record.fromStatus)) {
    throw new DomainError('VALIDATION_ERROR', 'fromStatus is not a valid project status.', 400);
  }
  if (!projectStatuses.includes(record.toStatus)) {
    throw new DomainError('VALIDATION_ERROR', 'toStatus is not a valid project status.', 400);
  }
  if (record.fromStatus === record.toStatus) {
    throw new DomainError(
      'VALIDATION_ERROR',
      'A persisted history record must represent an actual transition.',
      400,
    );
  }
  if (!isUtcIso(record.occurredAt)) {
    throw new DomainError('VALIDATION_ERROR', 'occurredAt must be a valid UTC ISO timestamp.', 400);
  }
  if (record.actorId !== null && record.actorId !== undefined && !isUuid(record.actorId)) {
    throw new DomainError('VALIDATION_ERROR', 'actorId must be a UUID or null.', 400);
  }
  if (record.revisionCycleId !== null && record.revisionCycleId !== undefined) {
    if (!isUuid(record.revisionCycleId)) {
      throw new DomainError('VALIDATION_ERROR', 'revisionCycleId must be a UUID or null.', 400);
    }
  }
}

/**
 * Validates the canonical persisted form of a RevisionCycle, including its
 * lifecycle shape. Open/ReturnedToClient/Cancelled have exactly these shapes:
 *   Open:            returnedToClientAt null, cancelledAt null, workStartedAt optional
 *   ReturnedToClient: returnedToClientAt required, cancelledAt null,
 *                     workStartedAt required, openedAt <= workStartedAt <= returnedToClientAt
 *   Cancelled:       cancelledAt required, returnedToClientAt null,
 *                    workStartedAt optional, openedAt <= cancelledAt
 * Throws DomainError on the first violating invariant.
 */
export function assertValidRevisionCycle(cycle: RevisionCycle): void {
  if (!isUuid(cycle.revisionCycleId)) {
    throw new DomainError('VALIDATION_ERROR', 'revisionCycleId must be a UUID.', 400);
  }
  if (!isUuid(cycle.projectId)) {
    throw new DomainError('VALIDATION_ERROR', 'projectId must be a UUID.', 400);
  }
  if (!Number.isInteger(cycle.cycleNumber) || cycle.cycleNumber < 1) {
    throw new DomainError('VALIDATION_ERROR', 'cycleNumber must be a positive integer.', 400);
  }
  if (!revisionCycleStatuses.includes(cycle.status)) {
    throw new DomainError('VALIDATION_ERROR', 'Invalid revision cycle status.', 400);
  }
  if (!isUtcIso(cycle.openedAt)) {
    throw new DomainError('VALIDATION_ERROR', 'openedAt must be a valid UTC ISO timestamp.', 400);
  }
  if (!isUuid(cycle.openedByTransitionId)) {
    throw new DomainError('VALIDATION_ERROR', 'openedByTransitionId must be a UUID.', 400);
  }
  if (!cycle.feedbackSummary || !cycle.feedbackSummary.trim()) {
    throw new DomainError(
      'VALIDATION_ERROR',
      'feedbackSummary must be meaningful non-empty text.',
      400,
    );
  }
  if (
    cycle.workStartedAt !== null &&
    cycle.workStartedAt !== undefined &&
    !isUtcIso(cycle.workStartedAt)
  ) {
    throw new DomainError(
      'VALIDATION_ERROR',
      'workStartedAt must be a valid UTC ISO timestamp.',
      400,
    );
  }
  if (
    cycle.returnedToClientAt !== null &&
    cycle.returnedToClientAt !== undefined &&
    !isUtcIso(cycle.returnedToClientAt)
  ) {
    throw new DomainError(
      'VALIDATION_ERROR',
      'returnedToClientAt must be a valid UTC ISO timestamp.',
      400,
    );
  }
  if (
    cycle.cancelledAt !== null &&
    cycle.cancelledAt !== undefined &&
    !isUtcIso(cycle.cancelledAt)
  ) {
    throw new DomainError(
      'VALIDATION_ERROR',
      'cancelledAt must be a valid UTC ISO timestamp.',
      400,
    );
  }

  const opened = Date.parse(cycle.openedAt);
  const workStarted = cycle.workStartedAt ? Date.parse(cycle.workStartedAt) : null;
  const returned = cycle.returnedToClientAt ? Date.parse(cycle.returnedToClientAt) : null;
  const cancelled = cycle.cancelledAt ? Date.parse(cycle.cancelledAt) : null;

  if (cycle.status === 'Open') {
    if (cycle.returnedToClientAt !== null) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'An Open cycle must not have returnedToClientAt set.',
        400,
      );
    }
    if (cycle.cancelledAt !== null) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'An Open cycle must not have cancelledAt set.',
        400,
      );
    }
  }

  if (cycle.status === 'ReturnedToClient') {
    if (cycle.workStartedAt === null) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'A ReturnedToClient cycle requires workStartedAt.',
        400,
      );
    }
    if (cycle.returnedToClientAt === null) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'A ReturnedToClient cycle requires returnedToClientAt.',
        400,
      );
    }
    if (cycle.cancelledAt !== null) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'A ReturnedToClient cycle must not have cancelledAt set.',
        400,
      );
    }
    if (workStarted !== null && returned !== null && workStarted > returned) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Impossible cycle timeline: workStartedAt is after returnedToClientAt.',
        400,
      );
    }
  }

  if (cycle.status === 'Cancelled') {
    if (cycle.cancelledAt === null) {
      throw new DomainError('VALIDATION_ERROR', 'A Cancelled cycle requires cancelledAt.', 400);
    }
    if (cycle.returnedToClientAt !== null) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'A Cancelled cycle must not have returnedToClientAt set.',
        400,
      );
    }
    if (cancelled !== null && cancelled < opened) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Impossible cycle timeline: cancelledAt is before openedAt.',
        400,
      );
    }
  }

  if (workStarted !== null && workStarted < opened) {
    throw new DomainError(
      'VALIDATION_ERROR',
      'Impossible cycle timeline: workStartedAt is before openedAt.',
      400,
    );
  }
}

// ===========================================================================
// P2.8A — Personal WorkSession domain model
// ===========================================================================
//
// A WorkSession represents actual work performed by the local Personal
// designer on one project. It is NOT project status, payroll, attendance,
// billing, invoicing, Team multi-user tracking, or workflow completion.
// Starting/stopping/switching a WorkSession must never change project.status.
//
// Canonical active state: endedAt === null. The Personal workspace invariant
// is AT MOST ONE active WorkSession globally for the local designer (across
// all projects), enforced by both the service and a database unique backstop.
//
// Duration is never persisted; it is derived from startedAt/endedAt (or,
// while active, current clock - startedAt) MINUS accumulatedPausedMs. A
// PAUSED session remains the current WorkSession (endedAt null, active) and
// simply holds a pausedAt boundary so no further elapsed accrues.

/** Canonical persisted form of a Personal work session. */
export interface WorkSession {
  attribution?: { actorId: string; actorName: string };
  id: string;
  projectId: string;
  startedAt: string;
  endedAt: string | null;
  /** Pause boundary (UTC ISO). NULL = RUNNING; set = PAUSED. */
  pausedAt: string | null;
  /** Total paused time accumulated across all Pause/Resume cycles in ms. */
  accumulatedPausedMs: number;
  createdAt: string;
}

/** Canonical derived state of a WorkSession. Never persisted. */
export type WorkSessionState = 'RUNNING' | 'PAUSED' | 'STOPPED';

/**
 * Single canonical state derivation. Do NOT scatter duplicate state inference
 * across store/API/frontend.
 */
export function workSessionState(session: WorkSession): WorkSessionState {
  if (session.endedAt !== null) return 'STOPPED';
  if (session.pausedAt !== null) return 'PAUSED';
  return 'RUNNING';
}

/**
 * Validates the canonical persisted form of a WorkSession. Throws DomainError
 * on the first violating invariant. Used by persistence and by domain tests;
 * the request contract separately governs wire input.
 */
export function assertValidWorkSession(session: WorkSession): void {
  if (!isUuid(session.id)) {
    throw new DomainError('VALIDATION_ERROR', 'WorkSession id must be a UUID.', 400);
  }
  if (!isUuid(session.projectId)) {
    throw new DomainError('VALIDATION_ERROR', 'WorkSession projectId must be a UUID.', 400);
  }
  if (!isUtcIso(session.startedAt)) {
    throw new DomainError(
      'VALIDATION_ERROR',
      'WorkSession startedAt must be a valid UTC ISO timestamp.',
      400,
    );
  }
  if (session.endedAt !== null && session.endedAt !== undefined) {
    if (!isUtcIso(session.endedAt)) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'WorkSession endedAt must be a valid UTC ISO timestamp or null.',
        400,
      );
    }
    if (Date.parse(session.endedAt) < Date.parse(session.startedAt)) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Impossible session timeline: endedAt is before startedAt.',
        400,
      );
    }
  }
  if (session.pausedAt !== null && session.pausedAt !== undefined) {
    if (!isUtcIso(session.pausedAt)) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'WorkSession pausedAt must be a valid UTC ISO timestamp or null.',
        400,
      );
    }
    if (Date.parse(session.pausedAt) < Date.parse(session.startedAt)) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Impossible session timeline: pausedAt is before startedAt.',
        400,
      );
    }
  }
  if (
    typeof session.accumulatedPausedMs !== 'number' ||
    !Number.isFinite(session.accumulatedPausedMs) ||
    !Number.isInteger(session.accumulatedPausedMs) ||
    session.accumulatedPausedMs < 0
  ) {
    throw new DomainError(
      'VALIDATION_ERROR',
      'WorkSession accumulatedPausedMs must be a finite non-negative integer.',
      400,
    );
  }
  // Invariant: a completed session can never be paused.
  if (session.endedAt !== null && session.pausedAt !== null && session.pausedAt !== undefined) {
    throw new DomainError('VALIDATION_ERROR', 'A completed WorkSession cannot be paused.', 400);
  }
  if (!isUtcIso(session.createdAt)) {
    throw new DomainError(
      'VALIDATION_ERROR',
      'WorkSession createdAt must be a valid UTC ISO timestamp.',
      400,
    );
  }
}
