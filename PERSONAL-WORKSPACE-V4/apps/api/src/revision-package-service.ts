import {
  createWriteStream,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import * as archiverModule from 'archiver';
import {
  DomainError,
  normalizeLuminaireTag,
  revisionPackageGroups,
  type AppUser,
  type Project,
  type ProjectQualityCheck,
  type ProjectWorkspace,
  type RevisionPackageCatalog,
  type RevisionPackageGroup,
  type RevisionPackageItem,
  type RevisionPackageManifestItem,
  type RevisionPackageRecord,
} from '@scli/domain';
import type { CreateRevisionPackageInput } from '@scli/contracts';
import type { PersonalWorkspaceStore } from './personal-workspace-store.js';
import type { CanonicalIssuePackageService } from './infrastructure/output-registry/CanonicalIssuePackageService.js';

interface ZipArchiveInstance {
  on(event: 'warning' | 'error', listener: (error: Error) => void): this;
  pipe(destination: NodeJS.WritableStream): NodeJS.WritableStream;
  directory(source: string, destination: string | false): this;
  finalize(): Promise<void>;
}

const { ZipArchive } = archiverModule as unknown as {
  ZipArchive: new (options: { zlib: { level: number } }) => ZipArchiveInstance;
};

const groupDirectories: Record<RevisionPackageGroup, string> = {
  SchedulePdf: '01_LUMINAIRE_SCHEDULE',
  ScheduleExcel: '01_LUMINAIRE_SCHEDULE',
  TechnicalBoqPdf: '02_TECHNICAL_BOQ',
  TechnicalBoqExcel: '02_TECHNICAL_BOQ',
  LayoutDrawings: '03_LAYOUT_DRAWINGS',
  DialuxReports: '04_DIALUX_REPORTS',
  Renderings: '05_RENDERS',
  Datasheets: '06_DATASHEETS',
  MeetingMinutes: '07_SUPPORTING_DOCUMENTS',
  CommentResponse: '07_SUPPORTING_DOCUMENTS',
  RevisionRegister: '07_SUPPORTING_DOCUMENTS',
  IssueSummary: '07_SUPPORTING_DOCUMENTS',
  CoverSheet: '07_SUPPORTING_DOCUMENTS',
  Documents: '07_SUPPORTING_DOCUMENTS',
};

const groupLabels: Record<RevisionPackageGroup, string> = {
  SchedulePdf: 'Luminaire Schedule PDF',
  ScheduleExcel: 'Luminaire Schedule Excel',
  TechnicalBoqPdf: 'Technical BOQ PDF',
  TechnicalBoqExcel: 'Technical BOQ Excel',
  LayoutDrawings: 'Lighting Layout Drawings',
  DialuxReports: 'DIALux Reports',
  Renderings: 'Renderings',
  Datasheets: 'Datasheets',
  MeetingMinutes: 'Meeting Minutes',
  CommentResponse: 'Comment Response Sheet',
  RevisionRegister: 'Revision Register',
  IssueSummary: 'Issue Summary',
  CoverSheet: 'Cover Sheet',
  Documents: 'Documents',
};

const documentGroups: Partial<
  Record<ProjectWorkspace['documents'][number]['category'], RevisionPackageGroup>
> = {
  Drawing: 'LayoutDrawings',
  LuxReport: 'DialuxReports',
  Visualization: 'Renderings',
  Datasheet: 'Datasheets',
  MeetingMinutes: 'MeetingMinutes',
  CommentResponse: 'CommentResponse',
  RevisionRegister: 'RevisionRegister',
  IssueSummary: 'IssueSummary',
  CoverSheet: 'CoverSheet',
};

function safeFileName(value: string): string {
  const printable = [...value].filter((character) => character.charCodeAt(0) >= 32).join('');
  const sanitized = printable.replaceAll(/[<>:"/\\|?*]/g, '_').trim();
  return sanitized || 'SCT_File';
}

function sourceItem(
  id: string,
  group: RevisionPackageGroup,
  label: string,
  filePath: string,
  outdated: boolean,
): RevisionPackageItem {
  if (!filePath || !existsSync(filePath)) {
    return {
      id,
      group,
      label,
      fileName: filePath ? path.basename(filePath) : '',
      filePath,
      available: false,
      outdated,
      sizeBytes: 0,
      modifiedAt: null,
      note: filePath ? 'The linked file is missing.' : 'No file is registered yet.',
    };
  }
  const stats = statSync(filePath);
  if (!stats.isFile()) {
    return {
      id,
      group,
      label,
      fileName: path.basename(filePath),
      filePath,
      available: false,
      outdated,
      sizeBytes: 0,
      modifiedAt: stats.mtime.toISOString(),
      note: 'The linked path is not a file.',
    };
  }
  return {
    id,
    group,
    label,
    fileName: path.basename(filePath),
    filePath,
    available: true,
    outdated,
    sizeBytes: stats.size,
    modifiedAt: stats.mtime.toISOString(),
    note: outdated ? 'This file may be older than the latest project changes.' : '',
  };
}

function packageChecks(workspace: ProjectWorkspace): ProjectQualityCheck[] {
  const duplicateTags = new Set<string>();
  const seenTags = new Set<string>();
  for (const luminaire of workspace.luminaires) {
    const tag = normalizeLuminaireTag(luminaire.tag);
    if (seenTags.has(tag)) duplicateTags.add(tag);
    seenTags.add(tag);
  }
  const requiredFields = new Set(
    [...workspace.lightingPackage.scheduleColumns, ...workspace.lightingPackage.boqColumns]
      .filter((column) => column.requiredForIssue)
      .map((column) => column.fieldKey),
  );
  const missingRequiredValues = workspace.luminaires.filter((luminaire) =>
    [...requiredFields].some((fieldKey) => {
      const value = luminaire[fieldKey as keyof typeof luminaire];
      return value === null || value === undefined || String(value).trim() === '';
    }),
  ).length;
  const priceColumns = [
    ...workspace.lightingPackage.scheduleColumns,
    ...workspace.lightingPackage.boqColumns,
  ].filter((column) => /price|cost|rate|amount|total/i.test(`${column.fieldKey} ${column.header}`));
  const checks: ProjectQualityCheck[] = [
    ...workspace.health.checks,
    {
      key: 'duplicate-luminaire-tags',
      label: 'Luminaire tags are unique',
      detail: duplicateTags.size
        ? `${duplicateTags.size} duplicated tag(s) must be resolved.`
        : 'No duplicate luminaire tags were found.',
      severity: 'Blocking',
      passed: duplicateTags.size === 0,
    },
    {
      key: 'required-output-fields',
      label: 'Required output fields are complete',
      detail: missingRequiredValues
        ? `${missingRequiredValues} luminaire row(s) have missing required values.`
        : 'Required schedule and BOQ values are complete.',
      severity: 'Blocking',
      passed: missingRequiredValues === 0,
    },
    {
      key: 'no-commercial-fields',
      label: 'No pricing fields in client outputs',
      detail: priceColumns.length
        ? `${priceColumns.length} commercial field(s) must be removed before issue.`
        : 'No price, cost or commercial total fields are configured.',
      severity: 'Blocking',
      passed: priceColumns.length === 0,
    },
  ];
  return [...new Map(checks.map((check) => [check.key, check])).values()];
}

function fileHash(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

async function createZip(sourceFolder: string, zipPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(zipPath, { flags: 'wx' });
    const archive = new ZipArchive({ zlib: { level: 9 } });
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('warning', (error) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') reject(error);
    });
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(sourceFolder, false);
    void archive.finalize();
  });
}

export class RevisionPackageService {
  public constructor(
    private readonly store: PersonalWorkspaceStore,
    private readonly canonicalService?: CanonicalIssuePackageService,
  ) {}

  public async catalog(
    project: Project,
    workspace: ProjectWorkspace,
    requestedRevisionId?: string,
  ): Promise<RevisionPackageCatalog> {
    if (this.canonicalService) {
      return await this.canonicalService.catalog(
        project,
        workspace,
        packageChecks(workspace),
        requestedRevisionId,
      );
    }
    void project;
    if (requestedRevisionId)
      throw new DomainError(
        'CONFLICT',
        'Canonical Revision catalog is unavailable in this runtime.',
        409,
      );
    const latestExport = workspace.exports[0];
    const latestLuminaireUpdate = workspace.luminaires.reduce(
      (latest, item) => (item.updatedAt > latest ? item.updatedAt : latest),
      '',
    );
    const exportOutdated = Boolean(
      latestExport && latestLuminaireUpdate && latestExport.createdAt < latestLuminaireUpdate,
    );
    const items: RevisionPackageItem[] = [];
    if (latestExport) {
      items.push(
        sourceItem(
          `export:${latestExport.id}:schedule-pdf`,
          'SchedulePdf',
          'Latest Luminaire Schedule PDF',
          latestExport.schedulePdfPath,
          exportOutdated,
        ),
        sourceItem(
          `export:${latestExport.id}:schedule-excel`,
          'ScheduleExcel',
          'Latest Luminaire Schedule Excel',
          latestExport.scheduleExcelPath,
          exportOutdated,
        ),
        sourceItem(
          `export:${latestExport.id}:boq-pdf`,
          'TechnicalBoqPdf',
          'Latest Technical BOQ PDF',
          latestExport.boqPdfPath,
          exportOutdated,
        ),
        sourceItem(
          `export:${latestExport.id}:boq-excel`,
          'TechnicalBoqExcel',
          'Latest Technical BOQ Excel',
          latestExport.boqExcelPath,
          exportOutdated,
        ),
      );
    }
    const seenDatasheets = new Set<string>();
    for (const luminaire of workspace.luminaires) {
      const normalized = path.resolve(luminaire.datasheetPath || '.').toLowerCase();
      if (!luminaire.datasheetPath || seenDatasheets.has(normalized)) continue;
      seenDatasheets.add(normalized);
      items.push(
        sourceItem(
          `datasheet:${luminaire.id}`,
          'Datasheets',
          `${luminaire.tag} · ${luminaire.manufacturer || luminaire.model || 'Datasheet'}`,
          luminaire.datasheetPath,
          false,
        ),
      );
    }
    for (const document of workspace.documents) {
      const group = documentGroups[document.category];
      if (!group) continue;
      if (
        group === 'Datasheets' &&
        seenDatasheets.has(path.resolve(document.filePath || '.').toLowerCase())
      )
        continue;
      items.push(
        sourceItem(
          `document:${document.id}`,
          group,
          document.title,
          document.filePath,
          document.status === 'Superseded',
        ),
      );
    }
    const registeredPaths = new Set(
      items
        .filter((item) => item.filePath)
        .map((item) => path.resolve(item.filePath).toLowerCase()),
    );
    const folderIndex = this.store.getFolderIndex(project.id);
    for (const indexed of folderIndex.items) {
      if (registeredPaths.has(path.resolve(indexed.filePath).toLowerCase())) continue;
      let group: RevisionPackageGroup | null = null;
      if (indexed.category === 'Drawings') group = 'LayoutDrawings';
      else if (indexed.category === 'Dialux') group = 'DialuxReports';
      else if (indexed.category === 'Renderings') group = 'Renderings';
      else if (indexed.category === 'Datasheets') group = 'Datasheets';
      else if (indexed.category === 'MeetingMinutes') group = 'MeetingMinutes';
      else if (indexed.category === 'TechnicalBoq') {
        group = ['.xls', '.xlsx', '.csv'].includes(indexed.extension)
          ? 'TechnicalBoqExcel'
          : 'TechnicalBoqPdf';
      } else if (indexed.category === 'Schedules') {
        group = ['.xls', '.xlsx', '.csv'].includes(indexed.extension)
          ? 'ScheduleExcel'
          : 'SchedulePdf';
      }
      if (!group) continue;
      items.push(
        sourceItem(`index:${indexed.id}`, group, indexed.relativePath, indexed.filePath, false),
      );
      registeredPaths.add(path.resolve(indexed.filePath).toLowerCase());
    }
    for (const group of revisionPackageGroups) {
      if (items.some((item) => item.group === group)) continue;
      items.push({
        id: `missing:${group}`,
        group,
        label: groupLabels[group],
        fileName: '',
        filePath: '',
        available: false,
        outdated: false,
        sizeBytes: 0,
        modifiedAt: null,
        note: 'No matching file is available. Register or generate it first.',
      });
    }
    const suggestedRevision = Math.max(
      latestExport?.revision ?? 0,
      workspace.revisions[0]?.revisionNumber ?? 0,
      1,
    );
    // C2 identity contract: the legacy/non-canonical branch must NEVER
    // manufacture canonical identity by ordinal reverse lookup (revisionNumber,
    // revisionSequence, suggestedRevision, label). It has no genuine canonical
    // Revision UUID of its own, so it reports null — consumers fail closed.
    return {
      items,
      checks: packageChecks(workspace),
      revisionId: null,
      suggestedRevision,
      suggestedOutputFolder: `ISSUED/REV_${String(suggestedRevision).padStart(2, '0')}`,
    };
  }

  public async create(
    project: Project,
    workspace: ProjectWorkspace,
    actor: AppUser,
    input: CreateRevisionPackageInput,
  ): Promise<RevisionPackageRecord> {
    if (this.canonicalService) {
      return this.canonicalService.create(
        project,
        workspace,
        actor,
        input,
        packageChecks(workspace),
      );
    }
    if (!workspace.folderPath) {
      throw new DomainError('VALIDATION_ERROR', 'Create or connect the project folder first.', 400);
    }
    const catalog = await this.catalog(project, workspace);
    const byId = new Map(catalog.items.map((item) => [item.id, item]));
    const selected = input.selectedItemIds.map((id) => byId.get(id));
    if (selected.some((item) => !item)) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'One or more selected files are no longer valid.',
        400,
      );
    }
    const files = selected as RevisionPackageItem[];
    const unavailable = files.filter((item) => !item.available);
    if (unavailable.length) {
      throw new DomainError(
        'VALIDATION_ERROR',
        `${unavailable.length} selected file(s) are missing or unavailable.`,
        400,
      );
    }
    const blocking = catalog.checks.filter(
      (check) => !check.passed && check.severity === 'Blocking',
    );
    if (input.status === 'Issued' && blocking.length) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Ready-to-Issue checks contain blocking items. Resolve them before creating the issue package.',
        400,
        { checks: blocking.map((check) => check.label) },
      );
    }
    const warnings = [
      ...catalog.checks.filter((check) => !check.passed && check.severity === 'Warning'),
      ...files.filter((item) => item.outdated).map((item) => ({ label: item.label })),
    ];
    if (input.status === 'Issued' && warnings.length && !input.warningOverrideReason.trim()) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Warnings must be resolved or overridden with a reason before issue.',
        400,
      );
    }
    if (input.status === 'Issued') this.store.createBackup('PRE_ISSUE');

    const root = path.resolve(workspace.folderPath);
    const targetFolder = path.resolve(root, input.relativeOutputFolder);
    const relativeTarget = path.relative(root, targetFolder);
    if (!relativeTarget || relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'The package folder must be inside the project.',
        400,
      );
    }
    const zipPath = `${targetFolder}.zip`;
    if (existsSync(targetFolder) || existsSync(zipPath)) {
      throw new DomainError(
        'CONFLICT',
        'This revision package already exists. Use a reissue label or another folder.',
        409,
      );
    }
    const stagingFolder =
      input.outputMode === 'Zip' ? path.join(root, `.scli-package-${randomUUID()}`) : targetFolder;
    mkdirSync(path.dirname(targetFolder), { recursive: true });
    mkdirSync(stagingFolder, { recursive: false });
    const usedNames = new Set<string>();
    const manifest: RevisionPackageManifestItem[] = [];
    try {
      for (const item of files) {
        const directory = path.join(stagingFolder, groupDirectories[item.group]);
        mkdirSync(directory, { recursive: true });
        const extension = path.extname(item.fileName || item.filePath);
        const base = safeFileName(path.basename(item.fileName || item.filePath, extension));
        let fileName = `${base}${extension}`;
        let suffix = 2;
        while (usedNames.has(`${item.group}:${fileName.toLowerCase()}`)) {
          fileName = `${base}_${suffix}${extension}`;
          suffix += 1;
        }
        usedNames.add(`${item.group}:${fileName.toLowerCase()}`);
        copyFileSync(item.filePath, path.join(directory, fileName));
        manifest.push({
          itemId: item.id,
          group: item.group,
          label: item.label,
          fileName: path.join(groupDirectories[item.group], fileName),
          sourcePath: item.filePath,
          sizeBytes: item.sizeBytes,
          sha256: fileHash(item.filePath),
        });
      }
      if (input.outputMode === 'Zip' || input.outputMode === 'Both') {
        await createZip(stagingFolder, zipPath);
      }
    } catch (error) {
      rmSync(stagingFolder, { recursive: true, force: true });
      if (existsSync(zipPath)) rmSync(zipPath, { force: true });
      throw error;
    }
    if (input.outputMode === 'Zip') rmSync(stagingFolder, { recursive: true, force: true });
    const packageHash = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
    const comparisonFields = new Set(
      [...workspace.lightingPackage.scheduleColumns, ...workspace.lightingPackage.boqColumns]
        .filter((column) => column.compareInRevision)
        .map((column) => column.fieldKey),
    );
    comparisonFields.add('tag');
    comparisonFields.add('unit');
    comparisonFields.add('quantity');
    const record: RevisionPackageRecord = {
      id: randomUUID(),
      projectId: project.id,
      revisionNumber: input.revisionNumber,
      reissueNumber: input.reissueNumber,
      label: input.label,
      status: input.status,
      outputMode: input.outputMode,
      folderPath: input.outputMode === 'Zip' ? '' : targetFolder,
      zipPath: input.outputMode === 'Folder' ? '' : zipPath,
      itemCount: manifest.length,
      totalBytes: manifest.reduce((total, item) => total + item.sizeBytes, 0),
      packageHash,
      warningOverrideReason: input.warningOverrideReason,
      manifest,
      luminaireSnapshot: workspace.luminaires.map((luminaire) => ({
        tag: luminaire.tag,
        values: Object.fromEntries(
          [...comparisonFields].map((fieldKey) => {
            const value = luminaire[fieldKey as keyof typeof luminaire];
            return [fieldKey, typeof value === 'number' ? value : String(value ?? '')];
          }),
        ),
      })),
      // V4-ISSUE-A0: the legacy compatibility writer derives the same server-side
      // Issue audit authority as the canonical path. Draft packages stay null.
      issuedById: input.status === 'Issued' ? actor.id : null,
      issuedByName: input.status === 'Issued' ? actor.displayName : null,
      issuedAt: input.status === 'Issued' ? new Date().toISOString() : null,
      createdAt: new Date().toISOString(),
    };
    return this.store.recordRevisionPackage(record);
  }
}
