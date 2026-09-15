import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { LegacyProjectImportInput } from '@scli/contracts';
import {
  DomainError,
  type AppUser,
  type DataProvider,
  type LegacyProjectCandidate,
  type LegacyProjectImportResult,
  type LegacyProjectPreview,
  type Project,
  type ProjectActivity,
  type ProjectFolderFileCategory,
  type ProjectFolderFileItem,
  type ProjectFolderIndex,
  type ProjectServiceCode,
} from '@scli/domain';
import type { PersonalWorkspaceStore } from './personal-workspace-store.js';

const ignoredDirectories = new Set([
  '.git',
  'node_modules',
  '$recycle.bin',
  'system volume information',
]);
const ignoredExtensions = new Set(['.tmp', '.lock', '.part']);
const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.psd']);
const drawingExtensions = new Set(['.dwg', '.dxf', '.rvt', '.rfa']);
const dialuxExtensions = new Set(['.evo', '.dlx']);

function normalized(value: string): string {
  return path.resolve(value).toLowerCase();
}

function dateFromLegacy(value: string): string | null {
  const year = 2000 + Number(value.slice(0, 2));
  const month = Number(value.slice(2, 4));
  const day = Number(value.slice(4, 6));
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return parsed.toISOString().slice(0, 10);
}

function parseFolder(folderName: string, folderPath: string): LegacyProjectCandidate {
  const match = /^(\d{3})[_\s-]+(SCT|SCLI?)(\d{6})[_\s-]+(.+)$/i.exec(folderName);
  const fallbackSequence = /^(\d{3})/.exec(folderName)?.[1];
  if (!match) {
    return {
      folderName,
      folderPath,
      recognized: false,
      sequenceNumber: fallbackSequence ? Number(fallbackSequence) : null,
      projectDate: null,
      projectCode: folderName,
      projectName: folderName.replaceAll(/[_-]+/g, ' ').trim(),
      duplicateProjectId: null,
      warnings: [
        'Folder name does not match the expected 000_SCLIYYMMDD_PROJECT or 000_SCTYYMMDD_PROJECT format.',
      ],
    };
  }
  const sequenceNumber = Number(match[1]);
  const prefix = match[2]!.toUpperCase();
  const projectDate = dateFromLegacy(match[3]!);
  const projectName = match[4]!.replaceAll(/[_-]+/g, ' ').replaceAll(/\s+/g, ' ').trim();
  const warnings: string[] = [];
  if (prefix !== 'SCLI' && prefix !== 'SCT') {
    warnings.push(`Unknown prefix ${prefix} will be kept exactly as written.`);
  }
  if (!projectDate) warnings.push('The date in the folder name is not a valid calendar date.');
  return {
    folderName,
    folderPath,
    recognized: Boolean(projectDate && projectName),
    sequenceNumber,
    projectDate,
    projectCode: folderName,
    projectName: projectName || folderName,
    duplicateProjectId: null,
    warnings,
  };
}

function requireDirectory(folderPath: string, label: string): string {
  const resolved = path.resolve(folderPath);
  if (!existsSync(resolved)) throw new DomainError('NOT_FOUND', `${label} was not found.`, 404);
  let stats;
  try {
    stats = statSync(resolved);
  } catch {
    throw new DomainError('VALIDATION_ERROR', `${label} cannot be read.`, 400);
  }
  if (!stats.isDirectory()) {
    throw new DomainError('VALIDATION_ERROR', `${label} must be a folder.`, 400);
  }
  return resolved;
}

function classifyFile(
  relativePath: string,
  extension: string,
): {
  category: ProjectFolderFileCategory;
  confidence: number;
} {
  const value = relativePath.toLowerCase().replaceAll('\\', '/');
  if (/data[ _-]*sheet|submittal|technical[ _-]*data/.test(value)) {
    return { category: 'Datasheets', confidence: 96 };
  }
  if (/dialux|lux[ _-]*(report|calculation)/.test(value) || dialuxExtensions.has(extension)) {
    return { category: 'Dialux', confidence: 96 };
  }
  if (/render|visuali[sz]ation|3d[ _-]*(view|image)/.test(value)) {
    return { category: 'Renderings', confidence: 94 };
  }
  if (/\bboq\b|bill[ _-]*of[ _-]*quantit/.test(value)) {
    return { category: 'TechnicalBoq', confidence: 96 };
  }
  if (/luminaire[ _-]*schedule|fixture[ _-]*schedule|lighting[ _-]*schedule/.test(value)) {
    return { category: 'Schedules', confidence: 94 };
  }
  if (/meeting[ _-]*minute|\bmom\b|minutes[ _-]*of[ _-]*meeting/.test(value)) {
    return { category: 'MeetingMinutes', confidence: 92 };
  }
  if (/drawing|layout|\bcad\b/.test(value) || drawingExtensions.has(extension)) {
    return { category: 'Drawings', confidence: drawingExtensions.has(extension) ? 97 : 84 };
  }
  if (imageExtensions.has(extension)) return { category: 'Renderings', confidence: 64 };
  return { category: 'Other', confidence: 35 };
}

export function suggestedServices(index: ProjectFolderIndex): ProjectServiceCode[] {
  const services = new Set<ProjectServiceCode>(['LuminaireSchedule', 'TechnicalBoq', 'Datasheets']);
  if (index.counts.Drawings) services.add('LightingLayout');
  if (index.counts.Dialux) {
    services.add('DialuxCalculation');
    services.add('DialuxReport');
  }
  if (index.counts.Renderings) services.add('Visualization3D');
  return [...services];
}

export function scanProjectFolder(
  folderPath: string,
  projectId = '00000000-0000-4000-8000-000000000000',
): ProjectFolderIndex {
  const root = requireDirectory(folderPath, 'Project folder');
  const indexedAt = new Date().toISOString();
  const oneDriveManaged = /(^|[\\/])onedrive(?:\s*-\s*[^\\/]+)?([\\/]|$)/i.test(root);
  const items: ProjectFolderFileItem[] = [];
  const pending: Array<{ directory: string; depth: number }> = [{ directory: root, depth: 0 }];
  let truncated = false;
  const maxFiles = 5_000;
  const maxDepth = 10;
  while (pending.length && items.length < maxFiles) {
    const current = pending.pop()!;
    let entries;
    try {
      entries = readdirSync(current.directory, { withFileTypes: true });
    } catch {
      truncated = true;
      continue;
    }
    for (const entry of entries) {
      if (items.length >= maxFiles) {
        truncated = true;
        break;
      }
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const filePath = path.join(current.directory, entry.name);
      if (entry.isDirectory()) {
        if (current.depth >= maxDepth || ignoredDirectories.has(entry.name.toLowerCase())) {
          if (current.depth >= maxDepth) truncated = true;
          continue;
        }
        pending.push({ directory: filePath, depth: current.depth + 1 });
        continue;
      }
      if (!entry.isFile() || entry.name.startsWith('~$')) continue;
      const extension = path.extname(entry.name).toLowerCase();
      if (ignoredExtensions.has(extension)) continue;
      const relativePath = path.relative(root, filePath);
      const classification = classifyFile(relativePath, extension);
      let sizeBytes = 0;
      let modifiedAt: string | null = null;
      let availability: ProjectFolderFileItem['availability'] = oneDriveManaged
        ? 'OneDriveManaged'
        : 'Local';
      try {
        const stats = statSync(filePath);
        sizeBytes = stats.size;
        modifiedAt = stats.mtime.toISOString();
      } catch {
        availability = 'Unavailable';
      }
      items.push({
        id: createHash('sha1').update(`${projectId}:${relativePath.toLowerCase()}`).digest('hex'),
        projectId,
        category: classification.category,
        fileName: entry.name,
        relativePath,
        filePath,
        extension,
        sizeBytes,
        modifiedAt,
        availability,
        confidence: classification.confidence,
        indexedAt,
      });
    }
  }
  const counts = {
    Drawings: 0,
    Dialux: 0,
    Renderings: 0,
    Schedules: 0,
    TechnicalBoq: 0,
    Datasheets: 0,
    MeetingMinutes: 0,
    Other: 0,
  } satisfies Record<ProjectFolderFileCategory, number>;
  for (const item of items) counts[item.category] += 1;
  return {
    projectId,
    folderPath: root,
    indexedAt,
    fileCount: items.length,
    totalBytes: items.reduce((total, item) => total + item.sizeBytes, 0),
    oneDriveManaged,
    truncated,
    counts,
    items,
  };
}

export class LegacyProjectImportService {
  public constructor(
    private readonly provider: DataProvider,
    private readonly store: PersonalWorkspaceStore,
  ) {}

  public async preview(rootPath: string): Promise<LegacyProjectPreview> {
    const root = requireDirectory(rootPath, 'Projects root');
    const existing = await this.provider.listProjects();
    const byPath = new Map(
      existing
        .filter((project) => project.projectFolderPath)
        .map((project) => [normalized(project.projectFolderPath!), project]),
    );
    const byCode = new Map(existing.map((project) => [project.projectCode.toLowerCase(), project]));
    const candidates = readdirSync(root, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          !entry.isSymbolicLink() &&
          !/^000[_\s-]*templ(?:ate|et)s?$/i.test(entry.name),
      )
      .map((entry) => parseFolder(entry.name, path.join(root, entry.name)))
      .map((candidate) => {
        const duplicate =
          byPath.get(normalized(candidate.folderPath)) ??
          byCode.get(candidate.projectCode.toLowerCase());
        return {
          ...candidate,
          duplicateProjectId: duplicate?.id ?? null,
          warnings: duplicate
            ? [...candidate.warnings, `Already linked to ${duplicate.projectCode}.`]
            : candidate.warnings,
        };
      })
      .sort(
        (left, right) =>
          (left.sequenceNumber ?? Number.MAX_SAFE_INTEGER) -
            (right.sequenceNumber ?? Number.MAX_SAFE_INTEGER) ||
          left.folderName.localeCompare(right.folderName),
      );
    const maxSequence = Math.max(0, ...candidates.map((item) => item.sequenceNumber ?? 0));
    return {
      rootPath: root,
      scannedAt: new Date().toISOString(),
      nextProjectNumber: maxSequence + 1,
      candidates,
    };
  }

  public scanFolders(folderPaths: string[]): ProjectFolderIndex[] {
    return folderPaths.map((folderPath) => scanProjectFolder(folderPath));
  }

  public async scanProject(projectId: string): Promise<ProjectFolderIndex> {
    const workspace = this.store.getWorkspace(projectId);
    if (!workspace.folderPath) {
      throw new DomainError('VALIDATION_ERROR', 'Connect the project folder first.', 400);
    }
    const index = scanProjectFolder(workspace.folderPath, projectId);
    const stored = this.store.replaceFolderIndex(index);
    const project = await this.provider.getProject(projectId);
    if (project) {
      await this.provider.updateProject(projectId, {
        folderIndexedAt: stored.indexedAt,
        folderFileCount: stored.fileCount,
        updatedAt: new Date().toISOString(),
        version: project.version + 1,
      });
    }
    return stored;
  }

  public async importProjects(
    actor: AppUser,
    input: LegacyProjectImportInput,
  ): Promise<LegacyProjectImportResult> {
    const root = requireDirectory(input.rootPath, 'Projects root');
    const existing = await this.provider.listProjects();
    const existingCodes = new Set(existing.map((project) => project.projectCode.toLowerCase()));
    const existingPaths = new Set(
      existing
        .map((project) => project.projectFolderPath)
        .filter((value): value is string => Boolean(value))
        .map(normalized),
    );
    const pendingCodes = new Set<string>();
    const pendingPaths = new Set<string>();
    const users = new Map((await this.provider.listUsers()).map((user) => [user.id, user]));
    for (const candidate of input.projects) {
      const resolved = requireDirectory(candidate.folderPath, 'Legacy project folder');
      const relative = path.relative(root, resolved);
      if (
        !relative ||
        relative.startsWith('..') ||
        path.isAbsolute(relative) ||
        path.dirname(relative) !== '.' ||
        path.basename(resolved) !== candidate.folderName
      ) {
        throw new DomainError(
          'VALIDATION_ERROR',
          `${candidate.folderName} is not a direct project folder inside the selected root.`,
          400,
        );
      }
      const code = candidate.projectCode.toLowerCase();
      const folder = normalized(resolved);
      if (existingCodes.has(code) || pendingCodes.has(code)) {
        throw new DomainError(
          'CONFLICT',
          `Project code ${candidate.projectCode} already exists.`,
          409,
        );
      }
      if (existingPaths.has(folder) || pendingPaths.has(folder)) {
        throw new DomainError('CONFLICT', `${candidate.folderName} is already linked.`, 409);
      }
      pendingCodes.add(code);
      pendingPaths.add(folder);
      if (candidate.salesOwnerId) {
        const salesperson = users.get(candidate.salesOwnerId);
        if (!salesperson || salesperson.role !== 'Sales' || !salesperson.isActive) {
          throw new DomainError('VALIDATION_ERROR', 'Choose an active Sales contact.', 400);
        }
      }
    }

    this.store.createBackup('PRE_LEGACY_IMPORT');
    const imported: LegacyProjectImportResult['imported'] = [];
    for (const candidate of input.projects) {
      const now = new Date().toISOString();
      const projectId = randomUUID();
      const owner = candidate.salesOwnerId ? users.get(candidate.salesOwnerId)! : actor;
      const ownerName = candidate.salesOwnerId ? owner.displayName : 'Unassigned';
      const progress = ['Completed', 'Archived'].includes(candidate.status) ? 100 : 0;
      const project: Project = {
        id: projectId,
        projectCode: candidate.projectCode,
        projectName: candidate.projectName,
        clientName: candidate.clientName,
        crmReference: candidate.crmReference ?? null,
        commercialValueMinor: candidate.commercialValueMinor ?? null,
        commercialCurrency: candidate.commercialCurrency ?? null,
        projectType: candidate.projectType,
        description: 'Imported from an existing project folder.',
        salesOwnerId: owner.id,
        salesOwnerNameSnapshot: ownerName,
        salesOwnerEmailSnapshot: candidate.salesOwnerId ? owner.email : '',
        createdById: actor.id,
        createdByNameSnapshot: actor.displayName,
        createdByEmailSnapshot: actor.email,
        assignedDesignerId: null,
        assignedDesignerNameSnapshot: null,
        collaboratorDesignerIds: [],
        collaboratorDesignerNameSnapshots: [],
        siteLocation: candidate.siteLocation,
        designStage: candidate.designStage,
        lightingScope: candidate.lightingScope,
        luxRequirements: '',
        drawingReference: '',
        status: candidate.status,
        priority: candidate.priority,
        complexity: 'Medium',
        estimatedHours: 0,
        actualHours: candidate.actualHours ?? 0,
        progressPercent: progress,
        requiredDeliveryDate: candidate.requiredDeliveryDate,
        projectFolderUrl: null,
        projectFolderPath: candidate.folderPath,
        folderProfile: 'Full Lighting Design',
        services: candidate.services,
        revisionNumber: 0,
        createdAt: `${candidate.createdDate}T12:00:00.000Z`,
        updatedAt: now,
        completedAt: null,
        cancelledAt: null,
        version: 1,
        isLegacyProject: true,
        legacyImportedAt: now,
        legacyFolderName: candidate.folderName,
        statusBeforeArchive: null,
        folderIndexedAt: null,
        folderFileCount: 0,
      };
      const activity: ProjectActivity = {
        id: randomUUID(),
        projectId,
        actionType: 'LegacyImported',
        fieldName: null,
        oldValue: null,
        newValue: null,
        message: `Legacy project linked from ${candidate.folderName}. No files were moved or changed.`,
        changedById: actor.id,
        changedByNameSnapshot: actor.displayName,
        createdAt: now,
      };
      await this.provider.createProject({
        project,
        activities: [activity],
        notifications: [],
        idempotencyKey: `legacy:${randomUUID()}`,
      });
      this.store.initializeProject(
        projectId,
        candidate.services,
        'Full Lighting Design',
        'Later',
        candidate.requiredDeliveryDate,
      );
      this.store.setFolderPath(projectId, candidate.folderPath);
      let fileCount = 0;
      let scanWarning = '';
      if (candidate.indexFiles) {
        try {
          const index = this.store.replaceFolderIndex(
            scanProjectFolder(candidate.folderPath, projectId),
          );
          fileCount = index.fileCount;
          await this.provider.updateProject(projectId, {
            folderIndexedAt: index.indexedAt,
            folderFileCount: index.fileCount,
          });
        } catch (error) {
          scanWarning = error instanceof Error ? error.message : 'Files could not be indexed.';
        }
      }
      imported.push({
        projectId,
        projectCode: candidate.projectCode,
        projectName: candidate.projectName,
        folderPath: candidate.folderPath,
        fileCount,
        scanWarning,
      });
    }
    const refreshed = await this.preview(root);
    if (this.provider.setProjectSequenceFloor) {
      await this.provider.setProjectSequenceFloor(refreshed.nextProjectNumber - 1);
    }
    return {
      imported,
      skipped: 0,
      nextProjectNumber: refreshed.nextProjectNumber,
    };
  }
}
